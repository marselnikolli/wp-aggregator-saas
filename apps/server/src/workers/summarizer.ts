import { Worker, Queue, Job } from 'bullmq'
import { fetch } from 'undici'
import { redis } from '../queue.js'
import { db } from '../db.js'
import { getSettingValue } from '../routes/settings.js'

export interface SummarizeJobData { postId: string }

export const summarizeQueue = new Queue<SummarizeJobData>('summarize', { connection: redis })

interface AiResult {
  summary:  string
  title:    string
  excerpt:  string
  keywords: string[]
  category: string
}

const SYSTEM_PROMPT = `You are a news editor. Given an article title and body, respond with JSON only:
{
  "title": "SEO-friendly rewritten title (fix ALL-CAPS, shorten, keep key nouns)",
  "summary": "2-3 sentence summary in the same language as the article",
  "excerpt": "1 sentence teaser in the same language (max 160 chars)",
  "keywords": ["up to 5 relevant topic keywords in the article's language"],
  "category": "single best-fit category from: Politics, Business, Sports, Technology, Entertainment, Health, Science, World, Crime, Culture, Opinion — match article language if the site is not English"
}
No extra text, only valid JSON.`

function parseAiJson(raw: string): AiResult | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (typeof parsed.summary === 'string' && typeof parsed.title === 'string') {
      return {
        summary:  parsed.summary,
        title:    parsed.title,
        excerpt:  typeof parsed.excerpt === 'string' ? parsed.excerpt : '',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((k: unknown) => typeof k === 'string').slice(0, 5) : [],
        category: typeof parsed.category === 'string' ? parsed.category : '',
      }
    }
    return null
  } catch { return null }
}

function computeQualityScore(post: {
  title: string; content: string | null; excerpt: string | null; imageUrl: string | null
}): number {
  let score = 0
  const contentLen = (post.content ?? '').replace(/<[^>]+>/g, '').length
  if (contentLen > 500)  score += 20
  if (contentLen > 1500) score += 20
  if (contentLen > 3000) score += 10
  if (post.imageUrl)     score += 20
  if (post.excerpt && post.excerpt.length > 20) score += 10
  if (post.title && post.title !== post.title.toUpperCase()) score += 10
  if (post.title && post.title.length <= 80) score += 10
  return Math.min(score, 100)
}

async function callAnthropic(key: string, title: string, content: string): Promise<AiResult | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: `Title: ${title}\n\nContent: ${content.slice(0, 3000)}` }],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)
  const data = await res.json() as { content: Array<{ text: string }> }
  return parseAiJson(data.content[0]?.text ?? '')
}

async function callOpenAI(key: string, title: string, content: string): Promise<AiResult | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:           'gpt-4o-mini',
      max_tokens:      500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Title: ${title}\n\nContent: ${content.slice(0, 3000)}` },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`)
  const data = await res.json() as { choices: Array<{ message: { content: string } }> }
  return parseAiJson(data.choices[0]?.message?.content ?? '')
}

async function processPost(postId: string) {
  const post = await db.aggregatedPost.findUniqueOrThrow({ where: { id: postId } })

  // Always compute quality score (local, no API needed)
  const qualityScore = computeQualityScore(post)

  const text = post.content ?? post.excerpt ?? ''
  const needsAi = !post.aiSummary || !post.aiTitle

  if (needsAi && text.length >= 100) {
    const anthropicKey = await getSettingValue('anthropic_key')
    const openaiKey    = await getSettingValue('openai_key')

    let result: AiResult | null = null
    if (anthropicKey) {
      result = await callAnthropic(anthropicKey, post.title, text)
    } else if (openaiKey) {
      result = await callOpenAI(openaiKey, post.title, text)
    }

    if (result) {
      const thresholdRow = await getSettingValue('quality_threshold')
      const threshold = thresholdRow ? Number(thresholdRow) : 0
      const extraCategories = [
        ...result.keywords.filter(k => !post.categories.includes(k)),
        ...(result.category && !post.categories.includes(result.category) ? [result.category] : []),
      ]
      await db.aggregatedPost.update({
        where: { id: postId },
        data: {
          aiSummary:      result.summary || undefined,
          aiTitle:        result.title   || undefined,
          excerpt:        (!post.excerpt || post.excerpt.length < 30) && result.excerpt ? result.excerpt : undefined,
          categories:     extraCategories.length ? [...post.categories, ...extraCategories] : undefined,
          qualityScore,
          approvalStatus: threshold > 0 && qualityScore >= threshold && post.approvalStatus === 'PENDING'
            ? 'APPROVED' : undefined,
        },
      })
      return
    }
  }

  // Update quality score even if no AI keys configured; auto-approve if threshold met
  const thresholdRow = await getSettingValue('quality_threshold')
  const threshold = thresholdRow ? Number(thresholdRow) : 0

  const approvalUpdate: Record<string, unknown> = { qualityScore }
  if (threshold > 0 && qualityScore >= threshold && post.approvalStatus === 'PENDING') {
    approvalUpdate.approvalStatus = 'APPROVED'
  }

  await db.aggregatedPost.update({ where: { id: postId }, data: approvalUpdate })
}

export function startSummarizerWorker() {
  const worker = new Worker<SummarizeJobData>(
    'summarize',
    async (job: Job<SummarizeJobData>) => {
      await processPost(job.data.postId)
    },
    { connection: redis, concurrency: 2 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[summarize-worker] job ${job?.id} failed:`, err.message)
  })

  return worker
}
