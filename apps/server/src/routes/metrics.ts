import { FastifyInstance } from 'fastify'
import { collectDefaultMetrics, Registry, Gauge, Counter } from 'prom-client'
import { db } from '../db.js'
import { redis } from '../queue.js'

const registry = new Registry()
collectDefaultMetrics({ register: registry })

const postGauge = new Gauge({
  name: 'aggregator_posts_total',
  help: 'Total aggregated posts by status',
  labelNames: ['publish_status'],
  registers: [registry],
})

const sourceGauge = new Gauge({
  name: 'aggregator_sources_total',
  help: 'Total sources by fetch status',
  labelNames: ['fetch_status', 'type'],
  registers: [registry],
})

const queueGauge = new Gauge({
  name: 'aggregator_queue_jobs',
  help: 'BullMQ queue job counts',
  labelNames: ['queue', 'state'],
  registers: [registry],
})

export const fetchedCounter = new Counter({
  name: 'aggregator_posts_fetched_total',
  help: 'Total posts fetched since startup',
  registers: [registry],
})

export const publishedCounter = new Counter({
  name: 'aggregator_posts_published_total',
  help: 'Total posts published since startup',
  registers: [registry],
})

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (_req, reply) => {
    // Refresh gauges on each scrape
    const [postGroups, sourceGroups] = await Promise.all([
      db.aggregatedPost.groupBy({
        by: ['publishStatus'],
        _count: { id: true },
      }),
      db.source.groupBy({
        by: ['fetchStatus', 'type'],
        _count: { id: true },
      }),
    ])

    postGauge.reset()
    for (const g of postGroups) {
      postGauge.set({ publish_status: g.publishStatus }, g._count.id)
    }

    sourceGauge.reset()
    for (const g of sourceGroups) {
      sourceGauge.set({ fetch_status: g.fetchStatus, type: g.type }, g._count.id)
    }

    // Queue stats from Redis
    try {
      const queues = ['fetch', 'publish', 'summarize', 'sched-publish']
      queueGauge.reset()
      for (const q of queues) {
        const [waiting, active, failed] = await Promise.all([
          redis.llen(`bull:${q}:wait`),
          redis.llen(`bull:${q}:active`),
          redis.zcard(`bull:${q}:failed`),
        ])
        queueGauge.set({ queue: q, state: 'waiting' }, waiting)
        queueGauge.set({ queue: q, state: 'active' }, active)
        queueGauge.set({ queue: q, state: 'failed' }, failed)
      }
    } catch { /* non-fatal */ }

    const metrics = await registry.metrics()
    reply.header('Content-Type', registry.contentType).send(metrics)
  })
}
