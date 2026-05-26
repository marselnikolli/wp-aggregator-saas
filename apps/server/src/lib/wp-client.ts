import { fetch } from 'undici'

interface WPPostPayload {
  title:           string
  content:         string
  excerpt?:        string
  status:          'draft' | 'publish' | 'future'
  date?:           string
  featured_media?: number
  categories?:     number[]
  tags?:           number[]
  author?:         number
}

interface WPMediaPayload {
  filename: string
  buffer:   Buffer
  mimeType: string
}

export class WPClient {
  private base:    string
  private siteUrl: string
  private auth:    string
  private categoryCache = new Map<string, number>()
  private tagCache      = new Map<string, number>()

  constructor(siteUrl: string, user: string, password: string, jwtToken?: string | null) {
    this.siteUrl = siteUrl.replace(/\/$/, '')
    this.base    = this.siteUrl + '/wp-json/wp/v2'
    this.auth    = jwtToken
      ? `Bearer ${jwtToken}`
      : 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
  }

  static async fetchJwtToken(siteUrl: string, user: string, password: string): Promise<string> {
    const base = siteUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/wp-json/jwt-auth/v1/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: user, password }),
      signal:  AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`JWT auth failed ${res.status}: ${err}`)
    }
    const data = await res.json() as { token?: string; data?: { token?: string } }
    const token = data.token ?? data.data?.token
    if (!token) throw new Error('JWT response did not contain a token')
    return token
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

  async getOrCreateCategory(name: string): Promise<number> {
    const key = name.toLowerCase()
    if (this.categoryCache.has(key)) return this.categoryCache.get(key)!

    // Search existing categories
    const searchRes = await fetch(
      `${this.base}/categories?search=${encodeURIComponent(name)}&per_page=20`,
      { headers: { Authorization: this.auth } },
    )
    if (searchRes.ok) {
      const cats = await searchRes.json() as Array<{ id: number; name: string }>
      const match = cats.find(c => c.name.toLowerCase() === key)
      if (match) {
        this.categoryCache.set(key, match.id)
        return match.id
      }
    }

    // Create if not found
    const createRes = await fetch(`${this.base}/categories`, {
      method: 'POST',
      headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!createRes.ok) throw new Error(`WP category create error ${createRes.status}`)
    const created = await createRes.json() as { id: number }
    this.categoryCache.set(key, created.id)
    return created.id
  }

  async getOrCreateTag(name: string): Promise<number> {
    const key = name.toLowerCase()
    if (this.tagCache.has(key)) return this.tagCache.get(key)!

    const searchRes = await fetch(
      `${this.base}/tags?search=${encodeURIComponent(name)}&per_page=20`,
      { headers: { Authorization: this.auth } },
    )
    if (searchRes.ok) {
      const tags = await searchRes.json() as Array<{ id: number; name: string }>
      const match = tags.find(t => t.name.toLowerCase() === key)
      if (match) { this.tagCache.set(key, match.id); return match.id }
    }

    const createRes = await fetch(`${this.base}/tags`, {
      method: 'POST',
      headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!createRes.ok) throw new Error(`WP tag create error ${createRes.status}`)
    const created = await createRes.json() as { id: number }
    this.tagCache.set(key, created.id)
    return created.id
  }

  async updatePost(wpPostId: number, payload: Partial<WPPostPayload>): Promise<{ id: number; link: string }> {
    const res = await fetch(`${this.base}/posts/${wpPostId}`, {
      method: 'POST',
      headers: { 'Authorization': this.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`WP API update error ${res.status}: ${err}`)
    }
    return res.json() as Promise<{ id: number; link: string }>
  }

  async getCategories(): Promise<{ id: number; name: string; slug: string }[]> {
    const res = await fetch(`${this.base}/categories?per_page=100`, {
      headers: { 'Authorization': this.auth },
    })
    if (!res.ok) throw new Error(`WP categories error ${res.status}`)
    return res.json() as Promise<{ id: number; name: string; slug: string }[]>
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
