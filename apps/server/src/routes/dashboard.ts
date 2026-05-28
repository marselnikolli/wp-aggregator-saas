import { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { fetchQueue, publishQueue } from '../queue.js'
import { summarizeQueue } from '../workers/summarizer.js'
import { socialQueue } from '../workers/socialWorker.js'

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/stats', { preHandler: [app.authenticate] }, async () => {
    const [sites, sources, pending, published, recentJobs] = await Promise.all([
      db.site.count({ where: { enabled: true } }),
      db.source.count({ where: { enabled: true } }),
      db.aggregatedPost.count({ where: { publishStatus: 'DRAFT' } }),
      db.aggregatedPost.count({ where: { publishStatus: 'PUBLISHED' } }),
      db.fetchJob.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { source: { select: { name: true } } },
      }),
    ])
    return { sites, sources, pending, published, recentJobs }
  })

  app.get('/dashboard/trending', { preHandler: [app.authenticate] }, async () => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    type Cluster = {
      title: string; count: number; latestAt: Date
      imageUrl: string | null; originalUrl: string | null; sources: string[]
    }
    const clusters = new Map<string, Cluster>()

    // Tier 1: semantic dup clusters (high confidence — embedding-level match)
    const duped = await db.aggregatedPost.findMany({
      where: { semanticDupOf: { not: null }, createdAt: { gte: since } },
      select: { id: true, title: true, semanticDupOf: true, sourceId: true,
                createdAt: true, imageUrl: true, originalUrl: true,
                source: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const rootIds = [...new Set(duped.map(p => p.semanticDupOf!))]
    const roots = rootIds.length ? await db.aggregatedPost.findMany({
      where: { id: { in: rootIds } },
      select: { id: true, title: true, sourceId: true, createdAt: true,
                imageUrl: true, originalUrl: true, source: { select: { name: true } } },
    }) : []

    for (const root of roots) {
      clusters.set(root.id, {
        title: root.title, count: 1, latestAt: root.createdAt,
        imageUrl: root.imageUrl, originalUrl: root.originalUrl,
        sources: root.source ? [root.source.name] : [],
      })
    }
    for (const p of duped) {
      const rootId = p.semanticDupOf!
      const c = clusters.get(rootId)
      const name = p.source?.name ?? ''
      if (c) {
        c.count++
        if (p.createdAt > c.latestAt) c.latestAt = p.createdAt
        if (!c.imageUrl && p.imageUrl) c.imageUrl = p.imageUrl
        if (name && !c.sources.includes(name)) c.sources.push(name)
      } else {
        clusters.set(rootId, {
          title: p.title, count: 2, latestAt: p.createdAt,
          imageUrl: p.imageUrl, originalUrl: p.originalUrl,
          sources: name ? [name] : [],
        })
      }
    }

    // Tier 2: keyword fingerprint grouping (catches stories before semantic dedup runs)
    const STOPWORDS = new Set(['that','this','have','from','with','will','been','were','they',
      'their','there','when','what','about','which','these','those','into','your','more',
      'also','some','than','then','well','after','before'])
    const titleKey = (t: string) =>
      t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
       .filter(w => w.length >= 5 && !STOPWORDS.has(w))
       .sort().slice(0, 6).join('|')

    const recent = await db.aggregatedPost.findMany({
      where: { semanticDupOf: null, createdAt: { gte: since } },
      select: { id: true, title: true, sourceId: true, createdAt: true,
                imageUrl: true, originalUrl: true, source: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    const groups = new Map<string, typeof recent>()
    for (const post of recent) {
      const key = titleKey(post.title)
      if (!key || key.split('|').length < 2) continue
      const g = groups.get(key) ?? []
      g.push(post)
      groups.set(key, g)
    }
    for (const [key, group] of groups) {
      if (group.length < 2) continue
      const distinctSources = new Set(group.map(p => p.sourceId))
      if (distinctSources.size < 2) continue
      const latest = group.reduce((a, b) => a.createdAt > b.createdAt ? a : b)
      const id = `kw:${key}`
      if (!clusters.has(id)) {
        clusters.set(id, {
          title: latest.title,
          count: distinctSources.size,
          latestAt: latest.createdAt,
          imageUrl: group.find(p => p.imageUrl)?.imageUrl ?? null,
          originalUrl: latest.originalUrl,
          sources: [...new Set(group.map(p => p.source?.name).filter((n): n is string => !!n))],
        })
      }
    }

    const trending = [...clusters.entries()]
      .map(([id, c]) => ({ id, ...c, sources: c.sources.slice(0, 5) }))
      .filter(c => c.count >= 2)
      .sort((a, b) => b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime())
      .slice(0, 12)

    return { trending }
  })

  app.get('/dashboard/activity', { preHandler: [app.authenticate] }, async () => {
    const rows = await db.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT TO_CHAR("publishedDate", 'YYYY-MM-DD') AS date, COUNT(*) AS count
      FROM "AggregatedPost"
      WHERE "publishedDate" >= NOW() - INTERVAL '30 days'
        AND "publishStatus" = 'PUBLISHED'
      GROUP BY date
      ORDER BY date ASC
    `
    // Fill in zero-count days for a full 30-day window
    const map = new Map(rows.map(r => [r.date, Number(r.count)]))
    const days: Array<{ date: string; count: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      days.push({ date: key, count: map.get(key) ?? 0 })
    }
    return { days }
  })

  app.get('/dashboard/queues', { preHandler: [app.authenticate] }, async () => {
    const [f, p, s, so] = await Promise.all([
      fetchQueue.getJobCounts('waiting', 'active', 'failed'),
      publishQueue.getJobCounts('waiting', 'active', 'failed'),
      summarizeQueue.getJobCounts('waiting', 'active', 'failed'),
      socialQueue.getJobCounts('waiting', 'active', 'failed'),
    ])
    return { fetch: f, publish: p, summarize: s, social: so }
  })
}
