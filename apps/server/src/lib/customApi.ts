import * as cheerio from 'cheerio'

const WRAPPER_KEYS = ['data', 'items', 'posts', 'results', 'articles', 'feed', 'list']

export function unwrapResponse(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const key of WRAPPER_KEYS) {
      const val = (data as Record<string, unknown>)[key]
      if (Array.isArray(val)) return val
    }
  }
  return []
}

export function resolveDotPath(path: string, obj: unknown): unknown {
  if (!path || !obj) return null
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur && typeof cur === 'object') return (cur as Record<string, unknown>)[key]
    return null
  }, obj) ?? null
}

export const CAT_NAME_KEYS = [
  'category', 'cat', 'section', 'rubric', 'tema', 'kategori', 'category_name', 'cat_name',
]

export const FIELD_GUESS_MAP: Record<string, string[]> = {
  title:       ['title', 'headline', 'name', 'titulli', 'subject'],
  content:     ['content', 'body', 'text', 'description', 'permbajtja', 'article_body'],
  excerpt:     ['excerpt', 'summary', 'short_description', 'abstract', 'lead'],
  imageUrl:    ['image', 'image_url', 'photo', 'thumbnail', 'img', 'cover', 'featured_image'],
  originalUrl: ['url', 'link', 'permalink', 'href', 'article_url'],
  remoteId:    ['id', 'post_id', 'article_id', 'nid', 'entry_id'],
  author:      ['author', 'writer', 'journalist', 'autori', 'byline'],
  sourcePublishedAt: ['date', 'pubDate', 'published', 'created_at', 'createdAt', 'published_at', 'publishedAt', 'date_gmt', 'isoDate'],
}

export function parseHtmlItems(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html)
  const items: Record<string, unknown>[] = []

  const tryExtract = (el: cheerio.Cheerio<any>) => {
    const $el = $(el)

    // Multiple selector strategies for title
    const titleSelectors = ['h2.a-head', 'h2', 'h3', 'h4', 'h1']
    let title = ''
    let href = ''
    let imageUrl = ''
    let category = ''
    let remoteId = ''

    for (const sel of titleSelectors) {
      const heading = $el.find(sel).first()
      if (heading.length) {
        title = heading.text().trim()
        if (title) {
          // URL from parent <a> or sibling <a>
          const link = heading.closest('a')
          if (link.length) {
            href = link.attr('href') ?? ''
          } else {
            const anyLink = $el.find('a[href]').first()
            if (anyLink.length) href = anyLink.attr('href') ?? ''
          }
          break
        }
      }
    }

    if (!title) {
      // Fallback: first <a> with substantial text
      const links = $el.find('a[href]')
      for (let i = 0; i < links.length; i++) {
        const t = $(links[i]).text().trim()
        if (t.length > 10) {
          title = t
          href = $(links[i]).attr('href') ?? ''
          break
        }
      }
    }

    if (!title) return null

    // Image: try data-src, data-lazy-src, then src
    const img = $el.find('img').first()
    if (img.length) {
      imageUrl = img.attr('data-src') ?? img.attr('data-lazy-src') ?? img.attr('src') ?? ''
    }

    // Category: span with short text, or specific class
    const catEl = $el.find('span.a-cat, .cat, .category, .section').first()
    if (catEl.length) {
      category = catEl.text().trim()
    }

    // ID from URL (Mediadesk pattern: -iNNNNN)
    if (href) {
      const idMatch = href.match(/-i(\d+)/)
      remoteId = idMatch ? idMatch[1] : ''
    }

    return { title, url: href, image: imageUrl, category, id: remoteId, content: '', excerpt: '' }
  }

  // Strategy 1: Known Mediadesk structure
  const cardSelectors = [
    'article.a-card', 'article.card', 'div.card',
    'article', 'div.post-card', 'div.article-card',
    '.a-card', '.card', '.post', '.item',
  ]
  let cards = null
  for (const sel of cardSelectors) {
    cards = $(sel)
    if (cards.length) break
  }

  if (cards && cards.length) {
    cards.each((_, el) => {
      const item = tryExtract($(el))
      if (item) items.push(item)
    })
    if (items.length) return items
  }

  // Strategy 2: Find repeating structures with <a> + <img> + heading
  $('body > div, body > section, body > main, body > article').each((_, container) => {
    const $container = $(container)
    $container.children().each((_, child) => {
      const $child = $(child)
      const hasHeading = $child.find('h1, h2, h3, h4, h5, h6').length > 0
      const hasImage = $child.find('img').length > 0
      const hasLink = $child.find('a[href]').length > 0
      if (hasHeading && hasImage && hasLink) {
        const item = tryExtract($child)
        if (item) items.push(item)
      }
    })
  })

  return items
}

const CONTENT_SELECTORS = [
  '.a-full-content', '.all-content',
  '[itemprop="articleBody"]',
  '.article-content', '.post-content', '.entry-content',
  '.content', '.post-body', '.article-body',
  'main', '#content', '#article', 'article',
]

export function parseArticleHtml(html: string, articleUrl?: string): { content: string; excerpt: string; imageUrl: string | null } {
  const $ = cheerio.load(html)

  let imageUrl: string | null =
    $('meta[property="og:image"]').attr('content')
    ?? $('meta[name="twitter:image"]').attr('content')
    ?? $('meta[property="og:image:url"]').attr('content')
    ?? null

  if (imageUrl && !imageUrl.startsWith('http') && articleUrl) {
    try { imageUrl = new URL(imageUrl, articleUrl).href } catch { /* keep */ }
  }

  let contentEl: cheerio.Cheerio<any> | null = null
  for (const sel of CONTENT_SELECTORS) {
    const el = $(sel).first()
    if (el.length && el.text().trim().length > 100) {
      contentEl = el
      break
    }
  }

  if (contentEl) {
    if (!imageUrl) {
      const firstImg = contentEl.find('img[src]').first()
      if (firstImg.length) {
        const src = firstImg.attr('src') ?? ''
        if (src && !src.startsWith('data:') && articleUrl) {
          try { imageUrl = src.startsWith('http') ? src : new URL(src, articleUrl).href } catch { /* ignore */ }
        }
      }
    }
  }

  if (!contentEl) {
    const $body = $('body')
    $body.find('script, style, noscript, nav, header, footer, aside, .sidebar, .menu, .comments').remove()
    const text = $body.text().trim()
    if (text.length > 100) {
      return { content: $body.html() ?? '', excerpt: text.slice(0, 300), imageUrl }
    }
    return { content: '', excerpt: '', imageUrl }
  }

  const text = contentEl.text().trim()
  return { content: contentEl.html() ?? '', excerpt: text.slice(0, 300), imageUrl }
}

export function tryParseBody(text: string): { items: unknown[]; isHtml: boolean } {
  let data: unknown
  try { data = JSON.parse(text) } catch { data = null }
  if (data) {
    const items = unwrapResponse(data)
    if (items.length) return { items, isHtml: false }
  }
  const htmlItems = parseHtmlItems(text)
  if (htmlItems.length) return { items: htmlItems, isHtml: true }
  return { items: [], isHtml: false }
}
