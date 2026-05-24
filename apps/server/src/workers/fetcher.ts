import { Worker, Job } from 'bullmq'
import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import { fetch } from 'undici'
import { redis } from '../queue.js'
import { db } from '../db.js'
import { decrypt } from '../lib/crypto.js'
import { SourceType } from '@prisma/client'

const rss = new Parser({ timeout: 10000 })

const ALLOWED_IFRAME_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'player.vimeo.com', 'vimeo.com',
  'dailymotion.com', 'twitch.tv', 'twitter.com', 'x.com', 'platform.twitter.com',
  'instagram.com', 'facebook.com', 'player.tiktok.com', 'linkedin.com',
  'rumble.com', 'bitchute.com', 'odysee.com',
]

const AD_PATTERN = /\b(ad|ads|advert|advertisement|adsense|adsbygoogle|google-ad|googlead|gam|dfp|banner-ad|ad-slot|ad-unit|ad-container|ad-wrapper|ad-banner|sponsor|sponsored|outbrain|taboola|revcontent|mgid|zedo|inread|inarticle|natve|native-ad|pub-\d)/i

function cleanContent(html: string): string {
  if (!html) return html
  const $ = cheerio.load(html)
  $('script, style, noscript').remove()
  $('ins').remove()
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') ?? $(el).attr('data-src') ?? ''
    try {
      const host = new URL(src).hostname.replace(/^www\./, '')
      if (!ALLOWED_IFRAME_HOSTS.some(d => host === d || host.endsWith('.' + d))) $(el).remove()
    } catch { $(el).remove() }
  })
  $('[class], [id]').each((_, el) => {
    const cls = $(el).attr('class') ?? ''
    const id  = $(el).attr('id') ?? ''
    if (AD_PATTERN.test(cls) || AD_PATTERN.test(id)) $(el).remove()
  })
  return $('body').html() ?? ''
}

export interface FetchJobData { sourceId: string }

function basicAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
}

async function fetchRss(endpoint: string, auth?: { username: string; password: string }) {
  if (auth) {
    const res = await fetch(endpoint, {
      headers: { Authorization: basicAuthHeader(auth.username, auth.password) },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`RSS fetch responded ${res.status}`)
    const xml = await res.text()
    const feed = await rss.parseString(xml)
    return feed.items.map(mapRssItem)
  }
  const feed = await rss.parseURL(endpoint)
  return feed.items.map(mapRssItem)
}

function mapRssItem(item: any) {
  return {
    remoteId:    item.guid ?? item.link ?? '',
    title:       item.title ?? '',
    content:     cleanContent(item.content ?? item.summary ?? ''),
    excerpt:     item.contentSnippet?.slice(0, 300) ?? '',
    imageUrl:    item.enclosure?.url ?? null,
    originalUrl: item.link ?? null,
    author:      item.creator ?? null,
    categories:  item.categories ?? [],
  }
}

async function fetchWpApi(endpoint: string, auth?: { username: string; password: string }) {
  const headers: Record<string, string> = {}
  if (auth) headers['Authorization'] = basicAuthHeader(auth.username, auth.password)

  const res = await fetch(
    endpoint + '?per_page=20&_fields=id,title,content,excerpt,link,author,date,categories',
    { headers, signal: AbortSignal.timeout(15000) },
  )
  if (!res.ok) throw new Error(`WP API responded ${res.status}`)
  const posts = await res.json() as Array<Record<string, any>>

  const catIds = [...new Set(posts.flatMap(p => p.categories ?? []))] as number[]
  let catMap: Record<number, string> = {}
  if (catIds.length) {
    try {
      const base = endpoint.replace('/wp-json/wp/v2/posts', '')
      const catRes = await fetch(
        `${base}/wp-json/wp/v2/categories?include=${catIds.join(',')}&per_page=100`,
        { headers, signal: AbortSignal.timeout(10000) },
      )
      if (catRes.ok) {
        const cats = await catRes.json() as Array<{ id: number; name: string }>
        catMap = Object.fromEntries(cats.map(c => [c.id, c.name]))
      }
    } catch { /* non-fatal */ }
  }

  return posts.map((p) => ({
    remoteId:    String(p.id),
    title:       p.title?.rendered ?? '',
    content:     cleanContent(p.content?.rendered ?? ''),
    excerpt:     p.excerpt?.rendered?.replace(/<[^>]+>/g, '').slice(0, 300) ?? '',
    imageUrl:    null,
    originalUrl: p.link ?? null,
    author:      null,
    categories:  (p.categories ?? []).map((id: number) => catMap[id]).filter(Boolean) as string[],
  }))
}

async function processSource(sourceId: string): Promise<{ fetched: number; newPosts: number }> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })

  let auth: { username: string; password: string } | undefined
  if (source.username && source.password) {
    try { auth = { username: source.username, password: decrypt(source.password) } }
    catch { /* bad decrypt — run without auth */ }
  }

  const items = source.type === SourceType.RSS
    ? await fetchRss(source.endpoint, auth)
    : await fetchWpApi(source.endpoint, auth)

  let newPosts = 0
  for (const item of items) {
    const hash = createHash('sha256')
      .update(source.id + item.remoteId + item.title)
      .digest('hex')
    const existing = await db.aggregatedPost.findUnique({ where: { hash } })
    if (existing) continue
    await db.aggregatedPost.create({
      data: {
        sourceId: source.id, remoteId: item.remoteId, title: item.title,
        content: item.content, excerpt: item.excerpt, imageUrl: item.imageUrl,
        originalUrl: item.originalUrl, author: item.author, categories: item.categories, hash,
      },
    })
    newPosts++
  }

  await db.source.update({
    where: { id: sourceId },
    data: { lastFetch: new Date(), fetchStatus: 'OK', fetchCount: { increment: 1 }, lastError: null },
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
          data: { fetchStatus: 'ERROR', errorCount: { increment: 1 }, lastError: error.slice(0, 200) },
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
