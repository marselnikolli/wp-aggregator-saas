import { fetch } from 'undici'

interface WPPostPayload {
  title:        string
  content:      string
  excerpt?:     string
  status:       'draft' | 'publish' | 'future'
  date?:        string
  featured_media?: number
  categories?:  number[]
}

interface WPMediaPayload {
  filename: string
  buffer:   Buffer
  mimeType: string
}

export class WPClient {
  private base: string
  private auth: string

  constructor(siteUrl: string, user: string, password: string) {
    this.base = siteUrl.replace(/\/$/, '') + '/wp-json/wp/v2'
    this.auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
  }

  async createPost(payload: WPPostPayload): Promise<{ id: number; link: string }> {
    const res = await fetch(`${this.base}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': this.auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`WP API error ${res.status}: ${err}`)
    }
    return res.json() as Promise<{ id: number; link: string }>
  }

  async uploadMedia(payload: WPMediaPayload): Promise<{ id: number; source_url: string }> {
    const res = await fetch(`${this.base}/media`, {
      method: 'POST',
      headers: {
        'Authorization': this.auth,
        'Content-Disposition': `attachment; filename="${payload.filename}"`,
        'Content-Type': payload.mimeType,
      },
      body: payload.buffer,
    })
    if (!res.ok) throw new Error(`WP media upload error ${res.status}`)
    return res.json() as Promise<{ id: number; source_url: string }>
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/users/me`, {
        headers: { 'Authorization': this.auth },
      })
      return res.ok
    } catch {
      return false
    }
  }
}
