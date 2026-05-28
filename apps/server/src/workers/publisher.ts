import { Worker, Job } from 'bullmq'
import { fetch } from 'undici'
import { redis, redisOpts } from '../queue.js'
import { db } from '../db.js'
import { WPClient } from '../lib/wp-client.js'
import { decrypt } from '../lib/crypto.js'
import { uploadImage } from '../lib/image-storage.js'
import { getSettingValue } from '../routes/settings.js'

export interface PublishJobData {
  publishTaskId: string
  aiPrompt?: string
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif',
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WPAggregator/1.0)' },
    })
    if (!res.ok) return null

    const contentType = res.headers.get('content-type') ?? ''
    const mimeType = contentType.split(';')[0].trim() || 'image/jpeg'
    if (!mimeType.startsWith('image/')) return null

    const arrayBuffer = await res.arrayBuffer()
    if (arrayBuffer.byteLength > 10 * 1024 * 1024) return null // skip >10 MB

    const urlPath = new URL(url).pathname
    const rawName = urlPath.split('/').pop() ?? 'image'
    const filename = rawName.includes('.') ? rawName : `${rawName}.jpg`
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const resolvedMime = EXT_MIME[ext] ?? mimeType

    return { buffer: Buffer.from(arrayBuffer), mimeType: resolvedMime, filename }
  } catch {
    return null
  }
}

async function reHostContentImages(content: string, client: WPClient, siteUrl: string): Promise<string> {
  const normalizedSite = siteUrl.replace(/\/$/, '')
  const srcRegex = /<img[^>]+src=["']([^"']+)["']/gi
  const urls = new Set<string>()
  let m
  while ((m = srcRegex.exec(content)) !== null) {
    const src = m[1]
    if (!src.startsWith('http') || src.startsWith(normalizedSite)) continue
    urls.add(src)
  }
  if (urls.size === 0) return content

  let result = content
  for (const originalUrl of urls) {
    try {
      const img = await downloadImage(originalUrl)
      if (!img) continue
      const media = await client.uploadMedia(img)
      result = result.split(originalUrl).join(media.source_url)
    } catch (err) {
      console.warn(`[publish-worker] content image re-host failed for ${originalUrl}:`, (err as Error).message)
    }
  }
  return result
}

async function applyAiPrompt(content: string, title: string, prompt: string): Promise<string> {
  const [anthropicKey, openaiKey] = await Promise.all([
    getSettingValue('anthropic_key'),
    getSettingValue('openai_key'),
  ])
  const system = `You are a content editor. Rewrite the provided article according to this instruction: ${prompt}\nReturn only the rewritten HTML content, nothing else.`
  const userMsg = `Title: ${title}\n\nContent: ${content.slice(0, 4000)}`

  if (anthropicKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system, messages: [{ role: 'user', content: userMsg }] }),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const data = await res.json() as { content: Array<{ text: string }> }
      return data.content[0]?.text ?? content
    }
  } else if (openaiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 2000, messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }] }),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) {
      const data = await res.json() as { choices: Array<{ message: { content: string } }> }
      return data.choices[0]?.message?.content ?? content
    }
  }
  return content
}

async function runPublishTask(taskId: string, aiPrompt?: string) {
  const task = await db.publishTask.findUniqueOrThrow({
    where:   { id: taskId },
    include: {
      post: { include: { source: { select: { categoryMap: true } } } },
      site: { select: { id: true, url: true, apiUser: true, apiPassword: true, jwtToken: true, defaultCategory: true, defaultAuthorId: true } },
    },
  })

  await db.publishTask.update({
    where: { id: taskId },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  })

  const jwtToken = task.site.jwtToken ? decrypt(task.site.jwtToken) : undefined
  const client = new WPClient(
    task.site.url,
    task.site.apiUser,
    decrypt(task.site.apiPassword),
    jwtToken,
  )

  let featuredMediaId: number | undefined
  if (task.post.imageUrl) {
    const img = await downloadImage(task.post.imageUrl)
    if (img) {
      // Try to re-host image in S3/R2 storage first
      const storedUrl = await uploadImage(img.buffer, img.mimeType, task.post.imageUrl)
      const imageSource = storedUrl
        ? { buffer: img.buffer, mimeType: img.mimeType, filename: img.filename }
        : img
      try {
        const media = await client.uploadMedia(imageSource)
        featuredMediaId = media.id
        // Persist stored URL so re-publish uses it directly
        if (storedUrl && storedUrl !== task.post.imageUrl) {
          await db.aggregatedPost.update({
            where: { id: task.post.id },
            data:  { imageUrl: storedUrl },
          })
        }
      } catch (err) {
        console.warn(`[publish-worker] image upload failed for task ${taskId}:`, (err as Error).message)
      }
    }
  }

  const categoryIds: number[] = []
  const tagIds: number[]      = []

  if (task.categoryOverride) {
    // Per-publish override wins over everything
    try { categoryIds.push(await client.getOrCreateCategory(task.categoryOverride)) }
    catch (err) { console.warn(`[publish-worker] category override "${task.categoryOverride}" failed:`, (err as Error).message) }
  } else {
    // Source-level category mapping: { siteId: { remoteCategory: localCategory } }
    const catMapForSite = ((task.post.source?.categoryMap as Record<string, Record<string, string>> | null)?.[task.site.id]) ?? {}
    for (const remoteName of task.post.categories) {
      const localName = catMapForSite[remoteName] ?? remoteName
      try { categoryIds.push(await client.getOrCreateCategory(localName)) }
      catch (err) { console.warn(`[publish-worker] category "${localName}" failed:`, (err as Error).message) }
    }
    if (task.site.defaultCategory) {
      try {
        const id = await client.getOrCreateCategory(task.site.defaultCategory)
        if (!categoryIds.includes(id)) categoryIds.push(id)
      } catch (err) {
        console.warn(`[publish-worker] default category failed:`, (err as Error).message)
      }
    }
  }

  const tagSources = task.tagOverrides?.length ? task.tagOverrides
    : task.post.categories.length ? task.post.categories
    : task.post.aiTags
  for (const name of tagSources) {
    try { tagIds.push(await client.getOrCreateTag(name)) }
    catch { /* tags are best-effort */ }
  }

  const wpStatus = (task.wpStatus ?? 'publish') as 'publish' | 'draft' | 'future'

  const baseContent = task.post.aiSummary ?? task.post.content ?? ''
  const rewrittenContent = aiPrompt && baseContent
    ? await applyAiPrompt(baseContent, task.post.aiTitle ?? task.post.title, aiPrompt).catch(() => baseContent)
    : baseContent
  const finalContent = await reHostContentImages(rewrittenContent, client, task.site.url)

  const payload = {
    title:           task.post.aiTitle ?? task.post.title,
    content:         finalContent,
    excerpt:         task.post.excerpt ?? undefined,
    status:          wpStatus,
    date:            task.scheduledDate?.toISOString(),
    featured_media:  featuredMediaId,
    categories:      categoryIds.length ? categoryIds : undefined,
    tags:            tagIds.length ? tagIds : undefined,
    author:          task.site.defaultAuthorId ?? undefined,
  }

  let finalWpPostId: number
  let finalWpUrl: string | undefined
  if (task.wpPostId) {
    const result = await client.updatePost(task.wpPostId, payload)
    finalWpPostId = result.id
    finalWpUrl = result.link
  } else {
    const result = await client.createPost(payload)
    finalWpPostId = result.id
    finalWpUrl = result.link
  }

  await db.publishTask.update({
    where: { id: taskId },
    data: { status: 'DONE', wpPostId: finalWpPostId, wpUrl: finalWpUrl ?? null },
  })

  await db.site.update({
    where: { id: task.site.id },
    data: { lastPublished: new Date() },
  })

  if (task.post.publishStatus !== 'PUBLISHED') {
    await db.aggregatedPost.update({
      where: { id: task.post.id },
      data: { publishStatus: 'PUBLISHED', publishedDate: new Date() },
    })
  }
}

export function startPublishWorker() {
  const worker = new Worker<PublishJobData, any, string>(
    'publish',
    async (job: Job<PublishJobData, any, string>) => {
      try {
        await runPublishTask(job.data.publishTaskId, job.data.aiPrompt)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        await db.publishTask.update({
          where: { id: job.data.publishTaskId },
          data: { status: 'FAILED', error },
        })
        throw err
      }
    },
    { connection: redisOpts, concurrency: 2 },
  )

  worker.on('failed', (job: Job<PublishJobData> | undefined, err: Error) => {
    console.error(`[publish-worker] job ${job?.id} failed:`, err.message)
  })

  return worker
}
