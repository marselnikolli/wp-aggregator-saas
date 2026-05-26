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

function buildSystemPrompt(translateTo?: string) {
  const outputLang = translateTo ? `in ${translateTo}` : 'in the same language as the article'
  const titleNote  = translateTo ? `translated to ${translateTo}, SEO-friendly` : 'SEO-friendly rewritten (fix ALL-CAPS, shorten, keep key nouns)'
  return `You are a news editor${translateTo ? ` and translator` : ''}. Given an article title and body, respond with JSON only:
{
  "title": "${titleNote}",
  "summary": "2-3 sentence summary ${outputLang}",
  "excerpt": "1 sentence teaser ${outputLang} (max 160 chars)",
  "keywords": ["up to 5 relevant topic keywords"],
  "category": "single best-fit category from: Politics, Business, Sports, Technology, Entertainment, Health, Science, World, Crime, Culture, Opinion"
}
No extra text, only valid JSON.`
}

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

async function callAnthropic(key: string, title: string, content: string, translateTo?: string): Promise<AiResult | null> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         key,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system:     buildSystemPrompt(translateTo),
      messages:   [{ role: 'user', content: `Title: ${title}\n\nContent: ${content.slice(0, 3000)}` }],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)
  const data = await res.json() as { content: Array<{ text: string }> }
  return parseAiJson(data.content[0]?.text ?? '')
}

async function callOpenAI(key: string, title: string, content: string, translateTo?: string): Promise<AiResult | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:           'gpt-4o-mini',
      max_tokens:      600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(translateTo) },
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
  const post = await db.aggregatedPost.findUniqueOrThrow({
    where: { id: postId },
    select: {
      id: true, sourceId: true, title: true, content: true, excerpt: true, imageUrl: true,
      aiSummary: true, aiTitle: true, language: true, categories: true,
      qualityScore: true, embedding: true, semanticDupOf: true,
    },
  })

  // Always compute quality score (local, no API needed)
  const qualityScore = computeQualityScore(post)

  const text = post.content ?? post.excerpt ?? ''
  const needsAi = !post.aiSummary || !post.aiTitle

  if (needsAi && text.length >= 100) {
    const [anthropicKey, openaiKey, translateToRow] = await Promise.all([
      getSettingValue('anthropic_key'),
      getSettingValue('openai_key'),
      getSettingValue('translate_to'),
    ])
    // Only translate if the post language differs from the target language
    const translateTo = translateToRow && post.language && !post.language.startsWith(translateToRow.slice(0, 2))
      ? translateToRow : undefined

    let result: AiResult | null = null
    if (anthropicKey) {
      result = await callAnthropic(anthropicKey, post.title, text, translateTo)
    } else if (openaiKey) {
      result = await callOpenAI(openaiKey, post.title, text, translateTo)
    }

    if (result) {
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
        },
      })
      // Reload post with updated AI fields for embedding
      const updated = await db.aggregatedPost.findUniqueOrThrow({
        where: { id: postId },
        select: { aiTitle: true, aiSummary: true, title: true, excerpt: true, embedding: true, semanticDupOf: true, sourceId: true },
      })
      if (!updated.embedding && !updated.semanticDupOf) {
        const openaiKey2 = await getSettingValue('openai_key')
        if (openaiKey2) {
          const input2 = `${updated.aiTitle ?? updated.title}\n${updated.aiSummary ?? updated.excerpt ?? ''}`
          const emb = await getEmbedding(openaiKey2, input2)
          if (emb) {
            const dupOf2 = await checkSemanticDuplicate(postId, emb, updated.sourceId)
            await db.aggregatedPost.update({
              where: { id: postId },
              data: {
                embedding:     JSON.stringify(emb),
                semanticDupOf: dupOf2 ?? undefined,
              },
            })
            if (dupOf2) console.info(`[summarizer] Post ${postId} semantic dup of ${dupOf2} — rejected`)
          }
        }
      }
      return
    }
  }

  await db.aggregatedPost.update({ where: { id: postId }, data: { qualityScore } })

  // Semantic duplicate detection (runs after main update to avoid blocking it)
  if (!post.embedding && !post.semanticDupOf) {
    const openaiKey = await getSettingValue('openai_key')
    if (openaiKey) {
      const input = `${post.aiTitle ?? post.title}\n${post.aiSummary ?? post.excerpt ?? ''}`
      const embedding = await getEmbedding(openaiKey, input)
      if (embedding) {
        const dupOf = await checkSemanticDuplicate(postId, embedding, post.sourceId)
        await db.aggregatedPost.update({
          where: { id: postId },
          data: {
            embedding:    JSON.stringify(embedding),
            semanticDupOf: dupOf ?? undefined,
          },
        })
        if (dupOf) {
          console.info(`[summarizer] Post ${postId} is semantic duplicate of ${dupOf} — auto-rejected`)
        }
      }
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function getEmbedding(key: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 2000) }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const data = await res.json() as { data: Array<{ embedding: number[] }> }
    return data.data[0]?.embedding ?? null
  } catch { return null }
}

const SEMANTIC_DUP_THRESHOLD = 0.94

async function checkSemanticDuplicate(postId: string, embedding: number[], sourceId: string): Promise<string | null> {
  // Check against posts from the same source within the last 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const candidates = await db.aggregatedPost.findMany({
    where: {
      id:        { not: postId },
      sourceId,
      embedding: { not: null },
      createdAt: { gte: cutoff },
    },
    select: { id: true, embedding: true },
    take: 500,
  })

  for (const c of candidates) {
    if (!c.embedding) continue
    try {
      const vec = JSON.parse(c.embedding) as number[]
      if (cosineSimilarity(embedding, vec) >= SEMANTIC_DUP_THRESHOLD) {
        return c.id
      }
    } catch { /* skip malformed */ }
  }
  return null
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
