import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { fetchQueue } from '../queue.js'

const sourceBody = z.object({
  name:     z.string().min(1),
  endpoint: z.string().url(),
  type:     z.enum(['RSS', 'WP_API']).default('RSS'),
  enabled:  z.boolean().optional().default(true),
})

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/sources', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({
      page:     z.coerce.number().min(1).default(1),
      per_page: z.coerce.number().min(1).max(100).default(20),
    }).parse(req.query)

    const [total, items] = await Promise.all([
      db.source.count(),
      db.source.findMany({
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { posts: true } } },
      }),
    ])
    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items }
  })

  app.post('/sources', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = sourceBody.parse(req.body)
    const source = await db.source.create({ data: body })
    return reply.code(201).send(source)
  })

  app.patch('/sources/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const body = sourceBody.partial().parse(req.body)
    return db.source.update({ where: { id }, data: body })
  })

  app.delete('/sources/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.source.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.post('/sources/:id/fetch', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    await db.source.findUniqueOrThrow({ where: { id } })
    const job = await fetchQueue.add('fetch-source', { sourceId: id }, { priority: 1 })
    return { jobId: job.id }
  })

  app.post('/sources/fetch-all', { preHandler: [app.authenticate] }, async () => {
    const sources = await db.source.findMany({ where: { enabled: true }, select: { id: true } })
    const jobs = await Promise.all(
      sources.map((s) => fetchQueue.add('fetch-source', { sourceId: s.id }))
    )
    return { queued: jobs.length }
  })
}
