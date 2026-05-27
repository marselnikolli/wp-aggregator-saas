import sharp from 'sharp'
import { writeFile } from 'fs/promises'
import { uploadImage } from './image-storage.js'

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
