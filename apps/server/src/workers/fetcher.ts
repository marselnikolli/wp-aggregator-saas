import { Worker, Job } from 'bullmq'
import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import { fetch, ProxyAgent } from 'undici'
import { redis } from '../queue.js'
import { db } from '../db.js'
import { decrypt } from '../lib/crypto.js'
import { SourceType } from '@prisma/client'
import { unwrapResponse, resolveDotPath } from '../lib/customApi.js'
import { summarizeQueue } from './summarizer.js'
import { franc } from 'franc'

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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const CF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

async function fetchCustomApi(source: {
  endpoint: string
  fieldMap: unknown
  categoryMappings: unknown
  paginationParam: string | null
  minDelaySec: number
  userAgent: string | null
  proxyUrl: string | null
}) {
  const fieldMap = (source.fieldMap as Record<string, string> | null) ?? {}
  const categoryMappings = (source.categoryMappings as Array<{ id: string; name: string }> | null) ?? []

  const dispatcher = source.proxyUrl ? new ProxyAgent(source.proxyUrl) : undefined
  const ua = source.userAgent ?? CF_UA
  const headers: Record<string, string> = {
    'User-Agent': ua,
    'Accept': 'application/json, text/plain, */*',
  }

  const results: ReturnType<typeof mapRssItem>[] = []

  for (const { id, name } of categoryMappings) {
    let page = 1
    while (true) {
      let url = source.endpoint.replace('{id}', id)
      if (source.paginationParam) url += `&${source.paginationParam}=${page}`

      let items: unknown[]
      try {
        const res = await fetch(url, { headers, dispatcher, signal: AbortSignal.timeout(15000) } as any)
        if (!res.ok) break
        const data = await res.json()
        items = unwrapResponse(data)
      } catch { break }

      if (!items.length) break

      if (source.minDelaySec > 0) await sleep(source.minDelaySec * 1000)

      for (const item of items) {
        const get = (field: string, fallback: string) =>
          resolveDotPath(fieldMap[field] ?? fallback, item)

        results.push({
          remoteId:    String(get('remoteId', 'id') ?? Math.random()),
          title:       String(get('title', 'title') ?? ''),
          content:     cleanContent(String(get('content', 'content') ?? '')),
          excerpt:     String(get('excerpt', 'excerpt') ?? '').slice(0, 300),
          imageUrl:    (get('imageUrl', 'image') as string | null) ?? null,
          originalUrl: (get('originalUrl', 'url') as string | null) ?? null,
          author:      (get('author', 'author') as string | null) ?? null,
          categories:  [name],
        })
      }

      if (!source.paginationParam) break
      page++
    }
  }

  return results
}

async function fireWebhook(post: { id: string; title: string; originalUrl: string | null; createdAt: Date }) {
  const row = await db.setting.findUnique({ where: { key: 'webhook_url' } })
  if (!row?.value) return
  try {
    await fetch(row.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'new_post', post }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* non-fatal */ }
}

async function getBlocklist(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: 'blocklist' } })
  return row ? JSON.parse(row.value) : []
}

function isBlocked(title: string, content: string | null, blocklist: string[]): boolean {
  if (!blocklist.length) return false
  const haystack = (title + ' ' + (content ?? '')).toLowerCase()
  return blocklist.some(word => haystack.includes(word))
}

const INTERVAL_CACHE_TTL: Record<string, number> = {
  '15m': 14 * 60,
  '1h':  55 * 60,
  '6h':  5 * 60 * 60,
  '24h': 23 * 60 * 60,
}

async function getCachedItems(sourceId: string): Promise<ReturnType<typeof mapRssItem>[] | null> {
  try {
    const raw = await redis.get(`feed-cache:${sourceId}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

async function setCachedItems(sourceId: string, interval: string | null, items: ReturnType<typeof mapRssItem>[]) {
  if (!interval) return
  const ttl = INTERVAL_CACHE_TTL[interval]
  if (!ttl) return
  try {
    await redis.set(`feed-cache:${sourceId}`, JSON.stringify(items), 'EX', ttl)
  } catch { /* non-fatal */ }
}

async function processSource(sourceId: string): Promise<{ fetched: number; newPosts: number }> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId } })

  let auth: { username: string; password: string } | undefined
  if (source.username && source.password) {
    try { auth = { username: source.username, password: decrypt(source.password) } }
    catch { /* bad decrypt — run without auth */ }
  }

  const cached = await getCachedItems(sourceId)
  const items = cached ?? (
    source.type === SourceType.RSS
      ? await fetchRss(source.endpoint, auth)
      : source.type === SourceType.WP_API
        ? await fetchWpApi(source.endpoint, auth)
        : await fetchCustomApi(source)
  )
  if (!cached) await setCachedItems(sourceId, source.interval, items)

  const blocklist = await getBlocklist()
  let newPosts = 0
  for (const item of items) {
    const hash = createHash('sha256')
      .update(source.id + item.remoteId + item.title)
      .digest('hex')
    const existing = await db.aggregatedPost.findUnique({ where: { hash } })
    if (existing) continue

    const blocked = isBlocked(item.title, item.content, blocklist)
    const created = await db.aggregatedPost.create({
      data: {
        sourceId: source.id, remoteId: item.remoteId, title: item.title,
        content: item.content, excerpt: item.excerpt, imageUrl: item.imageUrl,
        originalUrl: item.originalUrl, author: item.author, categories: item.categories, hash,
        approvalStatus: blocked ? 'REJECTED' : source.autoApprove ? 'APPROVED' : 'PENDING',
      },
    })
    // Language detection (sync, best-effort)
    const rawText = (item.title + ' ' + (item.content ?? item.excerpt ?? '')).replace(/<[^>]+>/g, '').slice(0, 1000)
    const lang = franc(rawText, { minLength: 20 })
    if (lang !== 'und') {
      await db.aggregatedPost.update({ where: { id: created.id }, data: { language: lang } })
    }

    await summarizeQueue.add('summarize', { postId: created.id }, { attempts: 2, backoff: { type: 'fixed', delay: 5000 } })
    fireWebhook({ id: created.id, title: created.title, originalUrl: created.originalUrl, createdAt: created.createdAt }).catch(() => {})
    newPosts++
  }

  await db.source.update({
    where: { id: sourceId },
    data: { lastFetch: new Date(), fetchStatus: 'OK', fetchCount: { increment: 1 }, lastError: null },
  })

  return { fetched: items.length, newPosts }
}

const LOCK_TTL_MS = 5 * 60 * 1000 // 5 minutes max per fetch job

async function acquireLock(sourceId: string): Promise<boolean> {
  const result = await (redis as any).set(`fetch-lock:${sourceId}`, '1', 'NX', 'PX', LOCK_TTL_MS)
  return result === 'OK'
}

async function releaseLock(sourceId: string) {
  await redis.del(`fetch-lock:${sourceId}`)
}

export function startFetchWorker() {
  const worker = new Worker<FetchJobData>(
    'fetch',
    async (job: Job<FetchJobData>) => {
      const { sourceId } = job.data

      // Distributed lock — skip if another worker is already fetching this source
      const locked = await acquireLock(sourceId)
      if (!locked) {
        console.log(`[fetch-worker] source ${sourceId} already being fetched, skipping`)
        return { fetched: 0, newPosts: 0, skipped: true }
      }

      const jobRecord = await db.fetchJob.create({
        data: { sourceId, status: 'PENDING' },
      })
      const start = Date.now()
      try {
        const { fetched, newPosts } = await processSource(sourceId)
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
          where: { id: sourceId },
          data: { fetchStatus: 'ERROR', errorCount: { increment: 1 }, lastError: error.slice(0, 200) },
        })
        throw err
      } finally {
        await releaseLock(sourceId)
      }
    },
    { connection: redis, concurrency: 3 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[fetch-worker] job ${job?.id} failed:`, err.message)
  })

  return worker
}
