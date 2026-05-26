import { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { getSettingValue } from './settings.js'

export async function feedRoutes(app: FastifyInstance) {
  app.get('/feed/:token.rss', async (req, reply) => {
    const { token } = req.params as { token: string }
    const savedToken = await getSettingValue('feed_token')
    if (!savedToken || savedToken !== token) {
      return reply.code(404).send('Not found')
    }

    const posts = await db.aggregatedPost.findMany({
      where:   { publishStatus: 'PUBLISHED' },
      orderBy: { publishedDate: 'desc' },
      take:    50,
      select:  { id: true, title: true, originalUrl: true, excerpt: true, publishedDate: true, imageUrl: true },
    })

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const items = posts.map(p => `
  <item>
    <title><![CDATA[${p.title}]]></title>
    <link>${esc(p.originalUrl ?? '')}</link>
    <guid isPermaLink="true">${esc(p.originalUrl ?? '')}</guid>
    <description><![CDATA[${p.excerpt ?? ''}]]></description>
    <pubDate>${new Date(p.publishedDate ?? Date.now()).toUTCString()}</pubDate>
    ${p.imageUrl ? `<enclosure url="${esc(p.imageUrl)}" type="image/jpeg" length="0"/>` : ''}
  </item>`).join('')

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Published Posts</title>
    <link>${process.env.CORS_ORIGIN ?? 'http://localhost'}</link>
    <description>Posts published via WP Aggregator</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <ttl>60</ttl>
${items}
  </channel>
</rss>`

    return reply
      .header('Content-Type', 'application/rss+xml; charset=utf-8')
      .send(feed)
  })
}
