import { Worker, Job } from 'bullmq'
import Parser from 'rss-parser'
import { createHash } from 'crypto'
import { fetch } from 'undici'
import { redis } from '../queue.js'
import { db } from '../db.js'
import { SourceType } from '@prisma/client'

const rss = new Parser({ timeout: 10000 })

export interface FetchJobData {
  sourceId: string
}

async function fetchRss(endpoint: string) {
  const feed = await rss.parseURL(endpoint)
  return feed.items.map((item) => ({
    remoteId:   item.guid ?? item.link ?? '',
    title:      item.title ?? '',
    content:    item.content ?? item.summary ?? '',
    excerpt:    item.contentSnippet?.slice(0, 300) ?? '',
    imageUrl:   (item.enclosure?.url) ?? null,
    originalUrl: item.link ?? null,
    author:     item.creator ?? null,
  }))
}

async function fetchWpApi(endpoint: string) {
  const res = await fetch(endpoint + '?per_page=20&_fields=id,title,content,excerpt,link,author,featured_media,date', {
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`WP API responded ${res.status}`)
  const posts = await res.json() as Array<Record<string, any>>
  return posts.map((p) => ({
    remoteId:    String(p.id),
    title:       p.title?.rendered ?? '',
    content:     p.content?.rendered ?? '',
    excerpt:     p.excerpt?.rendered?.replace(/<[^>]+>/g, '').slice(0, 300) ?? '',
    imageUrl:    null,
    originalUrl: p.link ?? null,
    author:      null,
  }))
}

async function processSource(sourceId: string): Promise<{ fetched: number; newPosts: number }> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })

  const items = source.type === SourceType.RSS
    ? await fetchRss(source.endpoint)
    : await fetchWpApi(source.endpoint)

  let newPosts = 0
  for (const item of items) {
    const hash = createHash('sha256')
      .update(source.id + item.remoteId + item.title)
      .digest('hex')

    const existing = await db.aggregatedPost.findUnique({ where: { hash } })
    if (existing) continue

    await db.aggregatedPost.create({
      data: {
        sourceId:   source.id,
        remoteId:   item.remoteId,
        title:      item.title,
        content:    item.content,
        excerpt:    item.excerpt,
        imageUrl:   item.imageUrl,
        originalUrl: item.originalUrl,
        author:     item.author,
        hash,
      },
    })
    newPosts++
  }

  await db.source.update({
    where: { id: sourceId },
    data: { lastFetch: new Date(), fetchStatus: 'OK' },
  })

  return { fetched: items.length, newPosts }
}

export function startFetchWorker() {
  const worker = new Worker<FetchJobData>(
    'fetch',
    async (job: Job<FetchJobData>) => {
      const jobRecord = await db.fetchJob.create({
        data: { sourceId: job.data.sourceId, status: 'PENDING' },
      })

      const start = Date.now()
      try {
        const { fetched, newPosts } = await processSource(job.data.sourceId)
        await db.fetchJob.update({
          where: { id: jobRecord.id },
          data: { status: 'OK', fetched, newPosts, duration: Date.now() - start },
        })
        return { fetched, newPosts }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        await db.fetchJob.update({
          where: { id: jobRecord.id },
          data: { status: 'ERROR', error, duration: Date.now() - start },
        })
        await db.source.update({
          where: { id: job.data.sourceId },
          data: { fetchStatus: 'ERROR' },
        })
        throw err
      }
    },
    { connection: redis, concurrency: 3 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[fetch-worker] job ${job?.id} failed:`, err.message)
  })

  return worker
}
