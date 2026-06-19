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
  includeContent?: boolean
  content?: string
  brandingText?: string
  emojiStyle?: 'category' | 'none'
}

function stripContent(html: string): string {
  let text = html
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > 1000) text = text.slice(0, 1000) + '…'
  return text
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
    includeContent = false,
    content,
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

  if (includeContent && content) {
    parts.push('\n\n' + stripContent(content))
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
