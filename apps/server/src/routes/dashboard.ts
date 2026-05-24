import { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { fetchQueue, publishQueue } from '../queue.js'

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/stats', { preHandler: [app.authenticate] }, async () => {
    const [sites, sources, pending, published, recentJobs] = await Promise.all([
      db.site.count({ where: { enabled: true } }),
      db.source.count({ where: { enabled: true } }),
      db.aggregatedPost.count({ where: { approvalStatus: 'PENDING' } }),
      db.aggregatedPost.count({ where: { publishStatus: 'PUBLISHED' } }),
      db.fetchJob.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { source: { select: { name: true } } },
      }),
    ])
    return { sites, sources, pending, published, recentJobs }
  })

  app.get('/dashboard/queues', { preHandler: [app.authenticate] }, async () => {
    const [f, p] = await Promise.all([
      fetchQueue.getJobCounts('waiting', 'active', 'failed'),
      publishQueue.getJobCounts('waiting', 'active', 'failed'),
    ])
    return { fetch: f, publish: p }
  })
}
