import { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { fetchQueue, publishQueue } from '../queue.js'
import { summarizeQueue } from '../workers/summarizer.js'

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
    // Find posts that share a semanticDupOf chain (same story, different sources)
    // plus posts with nearly identical titles within the last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Cluster by semanticDupOf: group posts where semanticDupOf points to the same root
    const duped = await db.aggregatedPost.findMany({
      where: { semanticDupOf: { not: null }, createdAt: { gte: since } },
      select: { id: true, title: true, semanticDupOf: true, sourceId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })

    // Also find the root posts that were referenced
    const rootIds = [...new Set(duped.map(p => p.semanticDupOf!))]
    const roots = rootIds.length ? await db.aggregatedPost.findMany({
      where: { id: { in: rootIds } },
      select: { id: true, title: true, sourceId: true, createdAt: true },
    }) : []

    // Build cluster map: rootId → { title, count, latestAt }
    const clusters = new Map<string, { title: string; count: number; latestAt: Date }>()
    for (const root of roots) {
      clusters.set(root.id, { title: root.title, count: 1, latestAt: root.createdAt })
    }
    for (const p of duped) {
      const rootId = p.semanticDupOf!
      const c = clusters.get(rootId)
      if (c) {
        c.count++
        if (p.createdAt > c.latestAt) c.latestAt = p.createdAt
      } else {
        clusters.set(rootId, { title: p.title, count: 2, latestAt: p.createdAt })
      }
    }

    const trending = [...clusters.entries()]
      .map(([id, c]) => ({ id, ...c }))
      .filter(c => c.count >= 2)
      .sort((a, b) => b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime())
      .slice(0, 10)

    return { trending }
  })

  app.get('/dashboard/queues', { preHandler: [app.authenticate] }, async () => {
    const [f, p, s] = await Promise.all([
      fetchQueue.getJobCounts('waiting', 'active', 'failed'),
      publishQueue.getJobCounts('waiting', 'active', 'failed'),
      summarizeQueue.getJobCounts('waiting', 'active', 'failed'),
    ])
    return { fetch: f, publish: p, summarize: s }
  })
}
