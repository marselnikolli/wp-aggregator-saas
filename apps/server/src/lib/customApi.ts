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
}

export function parseHtmlItems(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html)
  const items: Record<string, unknown>[] = []

  $('article.a-card').each((_, el) => {
    const $el = $(el)
    const linkEl = $el.find('h2.a-head').closest('a')
    const href = linkEl.attr('href') ?? ''
    const title = $el.find('h2.a-head').text().trim()
    const img = $el.find('img.a-media_img')
    const imageUrl = img.attr('data-src') ?? img.attr('src') ?? ''
    const category = $el.find('span.a-cat').text().trim()
    const idMatch = href.match(/-i(\d+)/)
    const remoteId = idMatch ? idMatch[1] : ''

    if (!title) return

    items.push({
      title,
      url: href,
      image: imageUrl,
      category,
      id: remoteId,
      content: '',
      excerpt: '',
    })
  })

  return items
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
