import sharp from 'sharp'
import { writeFile } from 'fs/promises'
import { uploadImage } from './image-storage.js'

// ──────────────────────────────────────────────────────────────────────────────
// Template-driven image generation
// ──────────────────────────────────────────────────────────────────────────────

/** Pixel size of the output canvas */
const CANVAS = 1080

/** Convert a percentage-based coordinate / size to pixels */
function px(pct: number): number {
  return Math.round(pct * 10.8)
}

// ── Google Fonts fetcher ───────────────────────────────────────────────────────
const fontCache = new Map<string, Buffer>()

async function fetchGoogleFont(family: string, weight = 700): Promise<Buffer | null> {
  const key = `${family}:${weight}`
  if (fontCache.has(key)) return fontCache.get(key)!
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`
    const cssRes = await fetch(cssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    })
    if (!cssRes.ok) return null
    const css = await cssRes.text()
    const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)
    if (!match?.[1]) return null
    const fontRes = await fetch(match[1], { signal: AbortSignal.timeout(8000) })
    if (!fontRes.ok) return null
    const buf = Buffer.from(await fontRes.arrayBuffer())
    fontCache.set(key, buf)
    return buf
  } catch {
    return null
  }
}

function fontFaceBlock(family: string, buf: Buffer): string {
  return `<defs><style>@font-face{font-family:'${family}';font-weight:700;src:url('data:font/woff2;base64,${buf.toString('base64')}')format('woff2');}</style></defs>`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Map a gradient direction string to a CSS/SVG angle in degrees */
function gradientAngle(direction: string): number {
  switch (direction) {
    case 'top':    return 0
    case 'bottom': return 180
    case 'left':   return 270
    case 'right':  return 90
    default:       return 180
  }
}

/** Build a full-canvas SVG linear-gradient overlay with independent start/end color stops. */
function buildTemplateGradientSvg(
  startColor: string, startOpacity: number,
  endColor: string,   endOpacity: number,
  angle: number,
): Buffer {
  const rad = (angle * Math.PI) / 180
  const x2 = parseFloat((0.5 + 0.5 * Math.sin(rad)).toFixed(4))
  const y2 = parseFloat((0.5 - 0.5 * Math.cos(rad)).toFixed(4))
  const x1 = parseFloat((1 - x2).toFixed(4))
  const y1 = parseFloat((1 - y2).toFixed(4))

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">` +
    `<defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
    `<stop offset="0%" stop-color="${startColor}" stop-opacity="${startOpacity}"/>` +
    `<stop offset="100%" stop-color="${endColor}" stop-opacity="${endOpacity}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${CANVAS}" height="${CANVAS}" fill="url(#g)"/>` +
    `</svg>`
  return Buffer.from(svg)
}

/** Compute the SVG x anchor and text-anchor value for a given alignment. */
function resolveTextAnchor(
  xPx: number, widthPx: number, align?: string,
): [anchorX: number, textAnchor: string] {
  switch (align) {
    case 'center': return [xPx + Math.round(widthPx / 2), 'middle']
    case 'right':  return [xPx + widthPx, 'end']
    default:       return [xPx, 'start']
  }
}

/** Apply a CSS-style text-transform to a string. */
function applyTextTransform(text: string, transform?: string): string {
  switch (transform) {
    case 'uppercase':  return text.toUpperCase()
    case 'lowercase':  return text.toLowerCase()
    case 'capitalize': return text.replace(/\b\w/g, c => c.toUpperCase())
    default:           return text
  }
}

/** Build a full-canvas SVG containing a text block positioned at (xPx, yPx). */
function buildTemplateTitleSvg(
  lines: string[], xPx: number, yPx: number,
  fontSize: number, color: string,
  fontFamily?: string, fontBuf?: Buffer,
  textAnchor = 'start',
): Buffer {
  const face   = fontBuf && fontFamily ? fontFaceBlock(fontFamily, fontBuf) : ''
  const family = fontFamily ? `'${fontFamily}', Arial, sans-serif` : 'Arial, sans-serif'
  const tspans = lines.map((line, i) =>
    `<tspan x="${xPx}" dy="${i === 0 ? '0' : '1.2em'}">${escapeXml(line)}</tspan>`,
  ).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">${face}` +
    `<text x="${xPx}" y="${yPx}" text-anchor="${textAnchor}" font-family="${family}" font-size="${fontSize}" ` +
    `font-weight="bold" fill="${color}" style="filter:drop-shadow(0 2px 8px rgba(0,0,0,0.8))">` +
    `${tspans}</text></svg>`
  return Buffer.from(svg)
}

/** Build a category badge SVG (pill or square) at (xPx, yPx). */
function buildCategoryBadgeSvg(
  label: string, xPx: number, yPx: number,
  color: string, badgeStyle: string, fontSize: number,
  textColor: string, fontFamily?: string, fontBuf?: Buffer,
): Buffer {
  const face   = fontBuf && fontFamily ? fontFaceBlock(fontFamily, fontBuf) : ''
  const family = fontFamily ? `'${fontFamily}', Arial, sans-serif` : 'Arial, sans-serif'
  const rx     = badgeStyle === 'square' ? 4 : 20
  const padX = 24, padY = 10
  const textW = Math.round(0.6 * fontSize * label.length)
  const rectW = textW + padX * 2
  const rectH = fontSize + padY * 2
  const textX = xPx + padX
  const textY = yPx + padY + fontSize - 4
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">${face}` +
    `<rect x="${xPx}" y="${yPx}" width="${rectW}" height="${rectH}" rx="${rx}" fill="${color}" fill-opacity="0.85"/>` +
    `<text x="${textX}" y="${textY}" font-family="${family}" font-size="${fontSize}" ` +
    `font-weight="bold" fill="${textColor}">${escapeXml(label)}</text>` +
    `</svg>`
  return Buffer.from(svg)
}

/** Build a simple text label SVG (for domain / watermark). */
function buildDomainTextSvg(
  text: string, xPx: number, yPx: number,
  fontSize: number, color: string,
  fontFamily?: string, fontBuf?: Buffer,
  textAnchor = 'start',
): Buffer {
  const face   = fontBuf && fontFamily ? fontFaceBlock(fontFamily, fontBuf) : ''
  const family = fontFamily ? `'${fontFamily}', Arial, sans-serif` : 'Arial, sans-serif'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">${face}` +
    `<text x="${xPx}" y="${yPx}" text-anchor="${textAnchor}" font-family="${family}" font-size="${fontSize}" ` +
    `fill="${color}">${escapeXml(text)}</text>` +
    `</svg>`
  return Buffer.from(svg)
}

export interface GenerateFromTemplateOpts {
  post: {
    title:      string
    categories: string[]
    imageUrl?:  string | null
  }
  template: {
    elements: any[]
    logoUrl?: string | null
  }
  categoryColors: Record<string, string>
}

export async function generateSocialImageFromTemplate(
  opts: GenerateFromTemplateOpts,
): Promise<Buffer> {
  const { post, template, categoryColors } = opts

  // ── 1. Base image ──────────────────────────────────────────────────────────
  let base: sharp.Sharp
  if (post.imageUrl) {
    const res = await fetch(post.imageUrl, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) throw new Error(`Failed to fetch background image: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    base = sharp(buf).resize(CANVAS, CANVAS, { fit: 'cover' })
  } else {
    base = sharp({
      create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } },
    })
  }

  // ── 2. Build composite layers ──────────────────────────────────────────────
  const composites: sharp.OverlayOptions[] = []

  for (const el of template.elements) {
    const xPx = px(el.x ?? 0)
    const yPx = px(el.y ?? 0)

    switch (el.type) {
      case 'gradient': {
        const endColor =
          el.colorSource === 'fixed'
            ? (el.fixedColor ?? '#1a1a2e')
            : (categoryColors[post.categories[0]] ?? '#1a1a2e')
        const startColor   = (el.startColor   ?? endColor)  as string
        const startOpacity = typeof el.startOpacity === 'number' ? el.startOpacity : 0
        const endOpacity   = typeof el.opacity      === 'number' ? el.opacity      : 0.85
        const angle        = gradientAngle(el.direction ?? 'bottom')
        const svgBuf       = buildTemplateGradientSvg(startColor, startOpacity, endColor, endOpacity, angle)
        composites.push({ input: svgBuf, blend: 'over' })
        break
      }

      case 'title': {
        const maxChars     = Math.round((el.maxCharsAtWidth ?? 35) as number)
        const maxLines     = (el.maxLines ?? 4) as number
        const fontSize     = (el.fontSize ?? 52) as number
        const color        = (el.color ?? '#ffffff') as string
        const fontFamily   = el.fontFamily as string | undefined
        const fontBuf      = fontFamily ? (await fetchGoogleFont(fontFamily)) ?? undefined : undefined
        const widthPx      = px(el.width ?? 90)
        const [axPx, anch] = resolveTextAnchor(xPx, widthPx, el.textAlign as string | undefined)
        const rawTitle     = applyTextTransform(post.title, el.textTransform as string | undefined)
        const lines        = wrapText(rawTitle, maxChars, maxLines)
        const svgBuf       = buildTemplateTitleSvg(lines, axPx, yPx, fontSize, color, fontFamily, fontBuf, anch)
        composites.push({ input: svgBuf, blend: 'over' })
        break
      }

      case 'category': {
        const rawLabel   = post.categories[0] ?? ''
        if (!rawLabel) break
        const label      = applyTextTransform(rawLabel, el.textTransform as string | undefined)
        const color      = categoryColors[rawLabel] ?? '#333333'
        const badgeStyle = (el.badgeStyle ?? 'pill') as string
        const fontSize   = (el.fontSize ?? 20) as number
        const textColor  = (el.textColor ?? '#ffffff') as string
        const fontFamily = el.fontFamily as string | undefined
        const fontBuf    = fontFamily ? (await fetchGoogleFont(fontFamily)) ?? undefined : undefined
        const svgBuf     = buildCategoryBadgeSvg(label, xPx, yPx, color, badgeStyle, fontSize, textColor, fontFamily, fontBuf)
        composites.push({ input: svgBuf, blend: 'over' })
        break
      }

      case 'logo': {
        if (!template.logoUrl) break
        const logoRes = await fetch(template.logoUrl, { signal: AbortSignal.timeout(12000) })
        if (!logoRes.ok) break
        const logoBuf  = Buffer.from(await logoRes.arrayBuffer())
        const widthPx  = Math.round((el.width ?? 20) * 10.8)
        const resized  = await sharp(logoBuf).resize(widthPx, undefined).toBuffer()
        composites.push({ input: resized, left: xPx, top: yPx, blend: 'over' })
        break
      }

      case 'domain': {
        const rawText    = (el.text ?? '') as string
        if (!rawText) break
        const text       = applyTextTransform(rawText, el.textTransform as string | undefined)
        const fontSize   = (el.fontSize ?? 24) as number
        const color      = (el.color ?? '#ffffff') as string
        const fontFamily = el.fontFamily as string | undefined
        const fontBuf    = fontFamily ? (await fetchGoogleFont(fontFamily)) ?? undefined : undefined
        const widthPx    = px(el.width ?? 40)
        const [axPx, anch] = resolveTextAnchor(xPx, widthPx, el.textAlign as string | undefined)
        const svgBuf     = buildDomainTextSvg(text, axPx, yPx, fontSize, color, fontFamily, fontBuf, anch)
        composites.push({ input: svgBuf, blend: 'over' })
        break
      }

      default:
        break
    }
  }

  // ── 3. Composite all layers and return JPEG buffer ─────────────────────────
  return base
    .composite(composites)
    .jpeg({ quality: 90 })
    .toBuffer()
}

interface ImageOptions {
  title: string
  categories?: string[]
  imageUrl?: string
  categoryColors?: Record<string, string>
  outputPath?: string
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (lines.length === maxLines) break
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
    } else {
      if (current) lines.push(current)
      current = word.slice(0, maxChars)
    }
  }

  if (current && lines.length < maxLines) lines.push(current)

  if (lines.length === maxLines) {
    const last = lines[maxLines - 1]
    if (last && last.length > maxChars - 1) {
      lines[maxLines - 1] = last.slice(0, maxChars - 1) + '…'
    }
  }

  return lines
}

function buildGradientSvg(color: string): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.1"/><stop offset="100%" stop-color="${color}" stop-opacity="0.85"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#g)"/></svg>`
  return Buffer.from(svg)
}

function buildTextSvg(lines: string[]): Buffer {
  const tspans = lines
    .map((line, i) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
      const dy = i === 0 ? '0' : '1.2em'
      return `<tspan x="80" dy="${dy}">${escaped}</tspan>`
    })
    .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><text x="80" y="820" font-family="Arial,sans-serif" font-size="52" font-weight="bold" fill="white" style="filter:drop-shadow(0 2px 8px rgba(0,0,0,0.8))">${tspans}</text></svg>`
  return Buffer.from(svg)
}

export async function generateSocialImage(opts: ImageOptions): Promise<Buffer> {
  const { title, categories = [], imageUrl, categoryColors = {}, outputPath } = opts

  const accentColor = (categories[0] && categoryColors[categories[0]]) ? categoryColors[categories[0]] : '#1a1a2e'

  let base: sharp.Sharp
  if (imageUrl) {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) throw new Error(`Failed to fetch background image: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    base = sharp(buf).resize(1080, 1080, { fit: 'cover' })
  } else {
    base = sharp({
      create: { width: 1080, height: 1080, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } },
    })
  }

  const lines = wrapText(title, 35, 4)
  const gradientSvg = buildGradientSvg(accentColor)
  const textSvg = buildTextSvg(lines)

  const result = await base
    .composite([
      { input: gradientSvg, blend: 'over' },
      { input: textSvg, blend: 'over' },
    ])
    .jpeg({ quality: 90 })
    .toBuffer()

  if (outputPath) {
    await writeFile(outputPath, result)
  }

  return result
}

export async function uploadSocialImage(buffer: Buffer, postId: string): Promise<string> {
  const s3Url = await uploadImage(buffer, 'image/jpeg', `social-${postId}`)
  if (s3Url) return s3Url

  console.warn('[social-image] S3 not configured — writing to /tmp. Real Instagram uploads require a public S3/R2 URL.')
  const tmpPath = `/tmp/social-${postId}.jpg`
  await writeFile(tmpPath, buffer)
  return `file://${tmpPath}`
}
