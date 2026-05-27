import { Worker, Job } from 'bullmq'
import Parser from 'rss-parser'
import * as cheerio from 'cheerio'
import { createHash } from 'crypto'
import { fetch, ProxyAgent } from 'undici'
import { redis, redisOpts } from '../queue.js'
import { db } from '../db.js'
import { decrypt } from '../lib/crypto.js'
import { SourceType } from '@prisma/client'
import { unwrapResponse, resolveDotPath, tryParseBody } from '../lib/customApi.js'
import { summarizeQueue } from './summarizer.js'
import { uploadImageFromUrl, slugify } from '../lib/image-storage.js'
import { franc } from 'franc'
import { getSettingValue } from '../routes/settings.js'
import { decode as decodeHtmlEntities } from 'entities'

const rss = new Parser({
  timeout: 10000,
  customFields: {
    item: [
      ['media:content',   'media:content',   { keepArray: false }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
      ['media:group',     'media:group',     { keepArray: false }],
    ],
  },
})

const ALLOWED_IFRAME_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'player.vimeo.com', 'vimeo.com',
  'dailymotion.com', 'twitch.tv', 'twitter.com', 'x.com', 'platform.twitter.com',
  'instagram.com', 'facebook.com', 'player.tiktok.com', 'linkedin.com',
  'rumble.com', 'bitchute.com', 'odysee.com',
]

const MAX_PER_FETCH = 15

const AD_PATTERN = /\b(ad|ads|advert|advertisement|adsense|adsbygoogle|google-ad|googlead|gam|dfp|banner-ad|ad-slot|ad-unit|ad-container|ad-wrapper|ad-banner|sponsor|sponsored|outbrain|taboola|revcontent|mgid|zedo|inread|inarticle|natve|native-ad|pub-\d)/i

// WP and news-site boilerplate blocks to remove entirely by CSS selector
const BOILERPLATE_SELECTORS = [
  // WP social share plugins
  '.sharedaddy', '.jp-relatedposts', '.yarpp-related',
  '.addtoany_share_save_container', '.wp-block-social-links',
  // Subscription / newsletter widgets
  '.subscribe-box', '.newsletter-box', '.mc4wp-form', '.mailchimp-form',
  // Comment sections
  '#comments', '.comments-area', '.comment-respond',
  // Author / tag / category metadata boxes
  '.author-box', '.author-info', '.post-author', '.tags-box', '.post-tags',
  '.post-categories', '.entry-footer', '.post-footer',
  // Cookie & GDPR notices
  '.cookie-notice', '.gdpr-notice', '.cookie-bar',
  // "Read also" / related post widgets (Albanian: "Lexo edhe:")
  '.related-posts', '.related-articles', '.related-post-box',
  '[class*="related-"]', '[id*="related-"]',
  // Misc noise
  '.printfriendly', '.wpcf7', '.wp-polls',
].join(',')

function cleanContent(html: string): string {
  if (!html) return html
  const $ = cheerio.load(html)

  // Pass 1 — scripts, styles, interactive elements
  $('script, style, noscript, ins, form, input, button, select, textarea, canvas, svg').remove()

  // Pass 2 — known WP/news boilerplate blocks
  try { $(BOILERPLATE_SELECTORS).remove() } catch { /* malformed selector guard */ }

  // Pass 3 — ad-pattern class/id (must run before attribute stripping)
  $('[class], [id]').each((_, el) => {
    const cls = $(el).attr('class') ?? ''
    const id  = $(el).attr('id')  ?? ''
    if (AD_PATTERN.test(cls) || AD_PATTERN.test(id)) $(el).remove()
  })

  // Pass 4 — iframe allowlist
  $('iframe, embed, object').each((_, el) => {
    const src = $(el).attr('src') ?? $(el).attr('data-src') ?? $(el).attr('data') ?? ''
    try {
      const host = new URL(src).hostname.replace(/^www\./, '')
      if (!ALLOWED_IFRAME_HOSTS.some(d => host === d || host.endsWith('.' + d))) $(el).remove()
    } catch { $(el).remove() }
  })

  // Pass 5 — promote lazy-loaded images (data-src / data-lazy-src → src)
  $('img[data-src], img[data-lazy-src], img[data-original]').each((_, el) => {
    const lazySrc = $(el).attr('data-src') ?? $(el).attr('data-lazy-src') ?? $(el).attr('data-original')
    if (lazySrc) $(el).attr('src', lazySrc)
  })

  // Pass 6 — remove tracking pixels (1×1 images or known beacon URLs)
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? ''
    const w   = parseInt($(el).attr('width')  ?? '999', 10)
    const h   = parseInt($(el).attr('height') ?? '999', 10)
    if (w <= 1 || h <= 1 || /\/(pixel|beacon|track|stat|analytics|impression)\//i.test(src)) {
      $(el).remove()
    }
  })

  // Pass 7 — strip noisy attributes from all elements
  $('*').each((_, el) => {
    const attribs: Record<string, string> = (el as any).attribs ?? {}
    const tag = ((el as any).tagName ?? '').toLowerCase()
    const toRemove: string[] = []

    for (const attr of Object.keys(attribs)) {
      if (attr.startsWith('on')) { toRemove.push(attr); continue }               // event handlers
      if (attr === 'style') { toRemove.push(attr); continue }                    // inline style noise
      if (attr.startsWith('data-') && attr !== 'data-src') { toRemove.push(attr); continue }
    }
    toRemove.forEach(a => $(el).removeAttr(a))

    // img: strip rendering hints & let target site handle responsive sizing
    if (tag === 'img') {
      $(el).removeAttr('srcset').removeAttr('sizes').removeAttr('loading')
           .removeAttr('decoding').removeAttr('fetchpriority')
           .removeAttr('width').removeAttr('height').removeAttr('class').removeAttr('id')
    }
    // a: keep only href, strip trackers
    if (tag === 'a') {
      const href = $(el).attr('href') ?? ''
      Object.keys((el as any).attribs ?? {}).forEach(a => $(el).removeAttr(a))
      if (href && !href.startsWith('javascript:')) $(el).attr('href', href)
    }
    // generic: strip class/id from non-semantic structural tags
    if (['div', 'span', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main'].includes(tag)) {
      $(el).removeAttr('class').removeAttr('id')
    }
  })

  // Pass 8 — remove empty block elements (bottom-up, two sweeps is enough)
  const BLOCK = 'p, div, section, article, aside, li, blockquote'
  for (let i = 0; i < 2; i++) {
    $(BLOCK).each((_, el) => {
      if (!$(el).text().trim() && $(el).find('img, iframe, video, audio').length === 0) {
        $(el).remove()
      }
    })
  }

  // Pass 9 — strip leading metadata (author bylines, datelines, site branding)
  const META_PATTERNS = [
    /^(autor|author|shkruan|nga|by|burimi|source|kategoria|category|dat[ëe]|date|published|updated|përditësuar|kontakt|email|website|site)\s*[:]/i,
    /^(foto|photo|image|pictures?)\s*(:|nga|by|from)\s/i,
    /^©\s*.+/i,
    /^[A-Z][a-z]+ [A-Z][a-z]+(\s+[|–—-]\s+\d+[./]\d+)/,
  ]
  const TEXT_ELS = 'p, div, li, h1, h2, h3, h4, h5, h6'
  for (let i = 0; i < 3; i++) {
    const el = $(TEXT_ELS).first()
    if (!el.length) break
    const text = el.text().trim()
    if (!text) { el.remove(); continue }
    if (text.length > 120) break
    if (META_PATTERNS.some(r => r.test(text))) { el.remove(); continue }
    break
  }

  let out = $('body').html() ?? ''

  // Pass 10 — collapse 3+ consecutive <br> down to 2
  out = out.replace(/(\s*<br\s*\/?>\s*){3,}/gi, '<br><br>')

  // Pass 11 — strip WP block comments and shortcodes
  out = out.replace(/<!--\s*\/?wp:[^>]*-->/gi, '')
  out = out.replace(/\[[a-z_-]+[^\]]*\]/gi, '')          // [gallery], [caption id=...], etc.
  out = out.replace(/&nbsp;(\s*&nbsp;)+/g, ' ')           // repeated &nbsp; runs

  return out.trim()
}

export interface FetchJobData { sourceId: string }

function basicAuthHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null
  try {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  } catch { return null }
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
    return feed.items.slice(0, MAX_PER_FETCH).map(mapRssItem)
  }
  const feed = await rss.parseURL(endpoint)
  return feed.items.slice(0, MAX_PER_FETCH).map(mapRssItem)
}

function extractRssImage(item: any): string | null {
  // 1. enclosure (podcast-style)
  if (item.enclosure?.url && item.enclosure.url.match(/\.(jpe?g|png|webp|gif|avif)/i)) return item.enclosure.url
  // 2. media:content
  const mc = item['media:content']
  if (mc) {
    const url = mc?.$ ?.url ?? mc?.url ?? (Array.isArray(mc) ? mc[0]?.$ ?.url : null)
    if (url) return url
  }
  // 3. media:thumbnail
  const mt = item['media:thumbnail']
  if (mt) {
    const url = mt?.$ ?.url ?? mt?.url ?? (Array.isArray(mt) ? mt[0]?.$ ?.url : null)
    if (url) return url
  }
  // 4. media:group > media:content
  const mg = item['media:group']
  if (mg) {
    const inner = mg['media:content'] ?? mg['media:thumbnail']
    if (inner) {
      const url = inner?.$ ?.url ?? inner?.url ?? (Array.isArray(inner) ? inner[0]?.$ ?.url : null)
      if (url) return url
    }
  }
  // 5. first <img> in content HTML
  const html = item.content ?? item.summary ?? ''
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (m?.[1] && !m[1].startsWith('data:')) return m[1]
  }
  return null
}

function mapRssItem(item: any) {
  return {
    remoteId:    item.guid ?? item.link ?? '',
    title:       decodeHtmlEntities(item.title ?? ''),
    content:     cleanContent(item.content ?? item.summary ?? ''),
    excerpt:     item.contentSnippet?.slice(0, 300) ?? '',
    imageUrl:    extractRssImage(item),
    originalUrl: item.link ?? null,
    author:      item.creator ?? null,
    categories:  item.categories ?? [],
    sourcePublishedAt: item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : null,
  }
}

async function fetchWpApi(endpoint: string, auth?: { username: string; password: string }) {
  const headers: Record<string, string> = {}
  if (auth) headers['Authorization'] = basicAuthHeader(auth.username, auth.password)

  const url = new URL(endpoint)
  url.searchParams.set('per_page', String(MAX_PER_FETCH))
  const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`WP API responded ${res.status}`)
  const posts = await res.json() as Array<Record<string, any>>

  return posts.map((p) => {
    const embedded = p._embedded ?? {}

    // Featured image from _embedded['wp:featuredmedia']
    const featuredMedia = embedded['wp:featuredmedia']?.[0]
    const imageUrl: string | null =
      featuredMedia?.source_url
      ?? featuredMedia?.media_details?.sizes?.medium_large?.source_url
      ?? featuredMedia?.media_details?.sizes?.medium?.source_url
      ?? featuredMedia?.media_details?.sizes?.full?.source_url
      ?? null

    // Category names from _embedded['wp:term']
    const termGroups: Array<Array<{ taxonomy: string; name: string }>> = embedded['wp:term'] ?? []
    const categories = termGroups
      .flat()
      .filter(t => t.taxonomy === 'category')
      .map(t => t.name)
      .filter(Boolean)

    return {
      remoteId:    String(p.id),
      title:       decodeHtmlEntities(p.title?.rendered ?? ''),
      content:     cleanContent(p.content?.rendered ?? ''),
      excerpt:     p.excerpt?.rendered?.replace(/<[^>]+>/g, '').slice(0, 300) ?? '',
      imageUrl,
      originalUrl: p.link ?? null,
      author:      (embedded['author']?.[0]?.name as string | undefined) ?? null,
      categories,
      sourcePublishedAt: p.date ? new Date(p.date) : p.date_gmt ? new Date(p.date_gmt) : null,
    }
  })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const CF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const SCRAPLING_PROXY = `http://127.0.0.1:${process.env.SCRAPLING_PROXY_PORT ?? '3002'}`

async function fetchViaScrapling(url: string): Promise<string> {
  try {
    const res = await fetch(SCRAPLING_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return ''
    const data = await res.json() as { success: boolean; html: string }
    return data.success ? data.html : ''
  } catch {
    return ''
  }
}

async function fetchWithFallback(url: string, headers: Record<string, string>, dispatcher?: any): Promise<{ text: string; ok: boolean }> {
  try {
    const res = await fetch(url, { headers, dispatcher, signal: AbortSignal.timeout(15000) } as any)
    if (res.ok) return { text: await res.text(), ok: true }
    // Cloudflare 403 — fall through to Scrapling
    if (res.status === 403) {
      const text = await fetchViaScrapling(url)
      if (text) return { text, ok: true }
    }
    return { text: '', ok: false }
  } catch {
    const text = await fetchViaScrapling(url)
    if (text) return { text, ok: true }
    return { text: '', ok: false }
  }
}

async function fetchArticleContent(
  url: string,
  dispatcher?: ProxyAgent,
  ua?: string,
): Promise<{ content: string; excerpt: string; imageUrl: string | null }> {
  try {
    const headers = { 'User-Agent': ua ?? CF_UA, 'Accept': 'text/html, */*' }
    const fetched = await fetchWithFallback(url, headers, dispatcher)
    if (!fetched.ok || !fetched.text) return { content: '', excerpt: '', imageUrl: null }
    const html = fetched.text
    const $ = cheerio.load(html)

    // Try to extract featured image from og:image or twitter:image meta tags first
    let featuredImageUrl: string | null =
      $('meta[property="og:image"]').attr('content')
      ?? $('meta[name="twitter:image"]').attr('content')
      ?? $('meta[name="twitter:image:src"]').attr('content')
      ?? null

    const selectors = [
      '.a-full-content', '.all-content',
      '[itemprop="articleBody"]',
      '.article-content', '.post-content', '.entry-content',
      'main',
      '#content',
      'article',
    ]

    let contentEl: cheerio.Cheerio<any> | null = null
    for (const sel of selectors) {
      const el = $(sel).first()
      if (el.length) { contentEl = el; break }
    }

    if (!contentEl || !contentEl.length) {
      const $body = $('body')
      $body.find('script, style, noscript, nav, header, footer, aside, .sidebar, .menu, .comments').remove()
      const text = $body.text().trim().slice(0, 10000)
      return { content: '', excerpt: text.slice(0, 300), imageUrl: featuredImageUrl }
    }

    // Capture the featured image from the first <img> before removing it
    const firstImg = contentEl.find('img').first()
    if (!featuredImageUrl && firstImg.length) {
      const src = firstImg.attr('data-src') ?? firstImg.attr('src') ?? ''
      if (src && !src.startsWith('data:')) {
        try {
          // Convert relative to absolute
          featuredImageUrl = src.startsWith('http') ? src : new URL(src, url).href
        } catch { /* ignore */ }
      }
    }

    // Strip the featured image from content to avoid duplication
    firstImg.remove()

    const html_content = contentEl.html() ?? ''
    const text = contentEl.text().trim()
    return { content: cleanContent(html_content), excerpt: text.slice(0, 300), imageUrl: featuredImageUrl }
  } catch {
    return { content: '', excerpt: '', imageUrl: null }
  }
}

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
  const baseUrl = (() => { try { return new URL(source.endpoint.replace('{id}', '1')).origin } catch { return '' } })()
  const maxPerCat = 1

  for (const { id, name } of categoryMappings) {
    if (results.length >= MAX_PER_FETCH) break
    let page = 1
    let catCount = 0
    while (true) {
      let url = source.endpoint.replace('{id}', id)
      if (source.paginationParam) url += `&${source.paginationParam}=${page}`

      let items: unknown[] = []
      let isHtml = false
      const fetched = await fetchWithFallback(url, headers, dispatcher)
      if (!fetched.ok || !fetched.text) break
      const parsed = tryParseBody(fetched.text)
      items = parsed.items
      isHtml = parsed.isHtml

      if (!items.length) break

      if (source.minDelaySec > 0) await sleep(source.minDelaySec * 1000)

      for (const item of items) {
        if (catCount >= maxPerCat || results.length >= MAX_PER_FETCH) break
        const resolved = item as Record<string, unknown>
        if (isHtml && typeof resolved.url === 'string' && resolved.url.startsWith('/') && baseUrl) {
          resolved.url = baseUrl + resolved.url
        }

        const get = (field: string, fallback: string) =>
          resolveDotPath(fieldMap[field] ?? fallback, resolved)

        let content = String(get('content', 'content') ?? '')
        let excerpt = String(get('excerpt', 'excerpt') ?? '')
        let imageUrl = (get('imageUrl', 'image') as string | null) ?? null

        // Fix relative image URLs from listing (e.g. Mediadesk HTML)
        if (imageUrl && !imageUrl.startsWith('http') && baseUrl) {
          try { imageUrl = new URL(imageUrl, baseUrl).href } catch { /* keep as-is */ }
        }

        if (isHtml && !content && typeof resolved.url === 'string' && resolved.url) {
          if (source.minDelaySec > 0) await sleep(source.minDelaySec * 1000)
          const scraped = await fetchArticleContent(resolved.url, dispatcher, ua)
          content = scraped.content
          if (!excerpt) excerpt = scraped.excerpt
          // Use scraped image if the listing didn't provide one
          if (!imageUrl && scraped.imageUrl) imageUrl = scraped.imageUrl
        }

        results.push({
          remoteId:    String(get('remoteId', 'id') ?? Math.random()),
          title:       decodeHtmlEntities(String(get('title', 'title') ?? '')),
          content:     cleanContent(content),
          excerpt:     excerpt.slice(0, 300),
          imageUrl,
          originalUrl: (get('originalUrl', 'url') as string | null) ?? null,
          author:      (get('author', 'author') as string | null) ?? null,
          categories:  [name],
          sourcePublishedAt: parseDate(get('sourcePublishedAt', 'date') as string | null),
        })
        catCount++
      }

      if (catCount >= maxPerCat) break
      if (!source.paginationParam) break
      page++
    }
  }

  return results
}

async function fireWebhook(post: { id: string; title: string; originalUrl: string | null; createdAt: Date }) {
  const row = await db.setting.findUnique({ where: { key: 'webhook_url' } })
  if (!row?.value) return
  const url = row.value
  const requestBody = JSON.stringify({ event: 'new_post', post })
  const start = Date.now()
  let statusCode: number | undefined
  let responseBody: string | undefined
  let success = false
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      signal: AbortSignal.timeout(5000),
    })
    statusCode = res.status
    responseBody = (await res.text()).slice(0, 500)
    success = res.ok
  } catch (err) {
    responseBody = (err as Error).message
  }
  db.webhookLog.create({
    data: { url, statusCode, requestBody, responseBody, durationMs: Date.now() - start, success },
  }).catch(() => {})
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

export async function tryOgImageFallback(postId: string, articleUrl: string): Promise<boolean> {
  try {
    const res = await fetch(articleUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WPAggregator/1.0)' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return false
    const html = await res.text()
    const $ = cheerio.load(html)
    const ogImage =
      $('meta[property="og:image"]').attr('content') ??
      $('meta[name="twitter:image"]').attr('content') ??
      $('meta[property="og:image:url"]').attr('content')
    if (!ogImage) return false
    const resolved = ogImage.startsWith('http') ? ogImage : new URL(ogImage, articleUrl).href
    const slug = slugify(articleUrl.split('/').pop() ?? postId) || postId
    const storedUrl = await uploadImageFromUrl(resolved, slug).catch(() => null)
    await db.aggregatedPost.update({ where: { id: postId }, data: { imageUrl: storedUrl ?? resolved } })
    return true
  } catch { return false }
}

export async function tryUnsplashFallback(postId: string, title: string): Promise<void> {
  const key = await getSettingValue('unsplash_api_key')
  if (!key) return
  const query = encodeURIComponent(title.replace(/<[^>]+>/g, '').slice(0, 80))
  const res = await fetch(`https://api.unsplash.com/search/photos?query=${query}&per_page=1&orientation=landscape`, {
    headers: { Authorization: `Client-ID ${key}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return
  const data = await res.json() as { results: Array<{ urls: { regular: string } }> }
  const url = data.results[0]?.urls?.regular
  if (!url) return
  const slug = slugify(title) || postId
  const storedUrl = await uploadImageFromUrl(url, slug).catch(() => null)
  await db.aggregatedPost.update({ where: { id: postId }, data: { imageUrl: storedUrl ?? url } })
}

async function processSource(sourceId: string, job?: Job<FetchJobData>): Promise<{ fetched: number; newPosts: number }> {
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
  await job?.updateProgress({ pct: 10, phase: 'fetched', total: items.length })

  const blocklist = await getBlocklist()
  let newPosts = 0
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const pct = Math.round(10 + (i / Math.max(items.length, 1)) * 85)
    await job?.updateProgress({ pct, phase: 'processing', current: i + 1, total: items.length })
    const hash = createHash('sha256')
      .update(source.id + item.remoteId + item.title)
      .digest('hex')
    const existing = await db.aggregatedPost.findUnique({ where: { hash } })
    if (existing) {
      if (!existing.imageUrl && item.imageUrl) {
        const slug = slugify(existing.title) || existing.id
        uploadImageFromUrl(item.imageUrl, slug)
          .then(s3Url => {
            const url = s3Url ?? item.imageUrl!
            db.aggregatedPost.update({ where: { id: existing.id }, data: { imageUrl: url } }).catch(() => {})
          })
          .catch(() => db.aggregatedPost.update({ where: { id: existing.id }, data: { imageUrl: item.imageUrl! } }).catch(() => {}))
      }
      continue
    }

    if (isBlocked(item.title, item.content, blocklist)) continue

    const created = await db.aggregatedPost.create({
      data: {
        sourceId: source.id, remoteId: item.remoteId, title: item.title,
        content: item.content, excerpt: item.excerpt, imageUrl: item.imageUrl,
        originalUrl: item.originalUrl, author: item.author, categories: item.categories, hash,
        sourcePublishedAt: (item as any).sourcePublishedAt ?? null,
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

    // Upload image to S3/R2 in background; update DB when done
    if (created.imageUrl) {
      const slug = slugify(created.title) || created.id
      uploadImageFromUrl(created.imageUrl, slug)
        .then(s3Url => {
          if (s3Url) db.aggregatedPost.update({ where: { id: created.id }, data: { imageUrl: s3Url } }).catch(() => {})
        })
        .catch(() => {})
    } else if (created.originalUrl) {
      tryOgImageFallback(created.id, created.originalUrl)
        .then(found => { if (!found) tryUnsplashFallback(created.id, created.title).catch(() => {}) })
        .catch(() => tryUnsplashFallback(created.id, created.title).catch(() => {}))
    } else {
      tryUnsplashFallback(created.id, created.title).catch(() => {})
    }

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
  const worker = new Worker<FetchJobData, any, string>(
    'fetch',
    async (job: Job<FetchJobData, any, string>) => {
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
        const { fetched, newPosts } = await processSource(sourceId, job)
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
        const updatedSource = await db.source.update({
          where: { id: sourceId },
          data: { fetchStatus: 'ERROR', errorCount: { increment: 1 }, lastError: error.slice(0, 200) },
          select: { id: true, name: true, errorCount: true, endpoint: true },
        })
        // Alert on configurable consecutive failure threshold
        const thresholdStr = await getSettingValue('broken_source_threshold').catch(() => null)
        const threshold = thresholdStr ? parseInt(thresholdStr) : 3
        if (updatedSource.errorCount >= 1 && updatedSource.errorCount % threshold === 0) {
          const webhookUrl = await getSettingValue('webhook_url').catch(() => null)
          if (webhookUrl) {
            fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'source.broken',
                source: { id: updatedSource.id, name: updatedSource.name, endpoint: updatedSource.endpoint },
                errorCount: updatedSource.errorCount,
                error,
                ts: new Date().toISOString(),
              }),
            }).catch(() => {})
          }
          const { sendSourceBrokenAlert } = await import('../lib/email.js')
          await sendSourceBrokenAlert(updatedSource.name, updatedSource.endpoint, error, updatedSource.errorCount)
        }
        throw err
      } finally {
        await releaseLock(sourceId)
      }
    },
    { connection: redisOpts, concurrency: 3 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[fetch-worker] job ${job?.id} failed:`, err.message)
  })

  return worker
}
