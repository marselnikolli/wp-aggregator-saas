import { Worker, Job } from 'bullmq'
import { fetch } from 'undici'
import { redis } from '../queue.js'
import { db } from '../db.js'
import { WPClient } from '../lib/wp-client.js'
import { decrypt } from '../lib/crypto.js'

export interface PublishJobData {
  publishTaskId: string
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

async function runPublishTask(taskId: string) {
  const task = await db.publishTask.findUniqueOrThrow({
    where:   { id: taskId },
    include: {
      post: { include: { source: { select: { categoryMap: true } } } },
      site: { select: { id: true, url: true, apiUser: true, apiPassword: true, defaultCategory: true, defaultAuthorId: true } },
    },
  })

  await db.publishTask.update({
    where: { id: taskId },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  })

  const client = new WPClient(
    task.site.url,
    task.site.apiUser,
    decrypt(task.site.apiPassword),
  )

  let featuredMediaId: number | undefined
  if (task.post.imageUrl) {
    const img = await downloadImage(task.post.imageUrl)
    if (img) {
      try {
        const media = await client.uploadMedia(img)
        featuredMediaId = media.id
      } catch (err) {
        console.warn(`[publish-worker] image upload failed for task ${taskId}:`, (err as Error).message)
      }
    }
  }

  // Source-level category mapping: { siteId: { remoteCategory: localCategory } }
  const catMapForSite = ((task.post.source?.categoryMap as Record<string, Record<string, string>> | null)?.[task.site.id]) ?? {}

  const categoryIds: number[] = []
  const tagIds: number[]      = []
  for (const remoteName of task.post.categories) {
    const localName = catMapForSite[remoteName] ?? remoteName
    try { categoryIds.push(await client.getOrCreateCategory(localName)) }
    catch (err) { console.warn(`[publish-worker] category "${localName}" failed:`, (err as Error).message) }
    try { tagIds.push(await client.getOrCreateTag(localName)) }
    catch { /* tags are best-effort */ }
  }
  if (task.site.defaultCategory) {
    try {
      const id = await client.getOrCreateCategory(task.site.defaultCategory)
      if (!categoryIds.includes(id)) categoryIds.push(id)
    } catch (err) {
      console.warn(`[publish-worker] default category failed:`, (err as Error).message)
    }
  }

  const wpStatus = (task.wpStatus ?? 'publish') as 'publish' | 'draft' | 'future'

  const payload = {
    title:           task.post.aiTitle ?? task.post.title,
    content:         task.post.aiSummary ?? task.post.content ?? '',
    excerpt:         task.post.excerpt ?? undefined,
    status:          wpStatus,
    date:            task.scheduledDate?.toISOString(),
    featured_media:  featuredMediaId,
    categories:      categoryIds.length ? categoryIds : undefined,
    tags:            tagIds.length ? tagIds : undefined,
    author:          task.site.defaultAuthorId ?? undefined,
  }

  let finalWpPostId: number
  if (task.wpPostId) {
    // Re-publish: update existing WP post
    const result = await client.updatePost(task.wpPostId, payload)
    finalWpPostId = result.id
  } else {
    const result = await client.createPost(payload)
    finalWpPostId = result.id
  }

  await db.publishTask.update({
    where: { id: taskId },
    data: { status: 'DONE', wpPostId: finalWpPostId },
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
  const worker = new Worker<PublishJobData>(
    'publish',
    async (job: Job<PublishJobData>) => {
      try {
        await runPublishTask(job.data.publishTaskId)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        await db.publishTask.update({
          where: { id: job.data.publishTaskId },
          data: { status: 'FAILED', error },
        })
        throw err
      }
    },
    { connection: redis, concurrency: 2 },
  )

  worker.on('failed', (job: Job<PublishJobData> | undefined, err: Error) => {
    console.error(`[publish-worker] job ${job?.id} failed:`, err.message)
  })

  return worker
}
