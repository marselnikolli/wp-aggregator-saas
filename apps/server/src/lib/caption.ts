export interface CaptionOptions {
  title: string
  categories: string[]
  aiTags: string[]
  originalUrl: string
  wpUrl?: string
  language?: string
  includeHashtags?: boolean
  includeExcerpt?: boolean
  excerpt?: string
  brandingText?: string
  emojiStyle?: 'category' | 'none'
}

const CATEGORY_EMOJI: Record<string, string> = {
  'Politikë':    '🏛️',
  'Sport':       '⚽',
  'Ekonomi':     '💰',
  'Teknologji':  '💻',
  'Shëndetësi':  '🏥',
  'Kulturë':     '🎭',
  'Botë':        '🌍',
  'Krim':        '🚨',
  'Aksidente':   '🚗',
  'Mjedis':      '🌿',
}

function pickEmoji(categories: string[]): string {
  for (const cat of categories) {
    const emoji = CATEGORY_EMOJI[cat]
    if (emoji) return emoji
  }
  return '📰'
}

function toHashtag(s: string): string {
  return '#' + s.replace(/\s+/g, '').toLowerCase()
}

export function generateCaption(opts: CaptionOptions): string {
  const {
    title,
    categories,
    aiTags,
    originalUrl,
    wpUrl,
    language = 'sq',
    includeHashtags = true,
    includeExcerpt = false,
    excerpt,
    brandingText,
    emojiStyle = 'category',
  } = opts

  const link = wpUrl || originalUrl

  const parts: string[] = []

  const prefix = emojiStyle === 'none' ? '' : pickEmoji(categories) + ' '
  parts.push(prefix + title)

  if (includeExcerpt && excerpt) {
    parts.push('\n' + excerpt)
  }

  parts.push('\n' + link)

  if (includeHashtags) {
    const tags: string[] = [
      ...categories.map(c => toHashtag(c)),
      ...aiTags.map(t => toHashtag(t)),
    ]
    const uniqueTags = [...new Set(tags)].slice(0, 10)
    if (uniqueTags.length > 0) {
      parts.push('\n' + uniqueTags.join(' '))
    }
  }

  if (brandingText) {
    parts.push('\n' + brandingText)
  }

  return parts.join('\n').trim()
}
