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
