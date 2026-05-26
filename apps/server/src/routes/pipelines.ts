import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { publishQueue } from '../queue.js'

const pipelineSchema = z.object({
  name:          z.string().min(1).max(80),
  enabled:       z.boolean().default(true),
  sourceFilter:  z.array(z.string()).nullable().default(null),
  qualityMin:    z.number().int().min(0).max(100).default(0),
  autoPublish:   z.boolean().default(false),
  siteIds:       z.array(z.string()).default([]),
  defaultStatus: z.enum(['publish', 'draft']).default('publish'),
  schedule:      z.string().nullable().default(null),
  sortOrder:     z.number().int().default(0),
})

export async function pipelinesRoutes(app: FastifyInstance) {
  app.get('/pipelines', { onRequest: [app.authenticate] }, async () => {
    const pipelines = await db.pipeline.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
    return pipelines
  })

  app.post('/pipelines', { onRequest: [app.authenticate] }, async (req) => {
    const data = pipelineSchema.parse(req.body)
    return db.pipeline.create({ data: { ...data, sourceFilter: data.sourceFilter ?? undefined } })
  })

  app.patch('/pipelines/:id', { onRequest: [app.authenticate] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const data = pipelineSchema.partial().parse(req.body)
    return db.pipeline.update({ where: { id }, data: { ...data, sourceFilter: data.sourceFilter ?? undefined } })
  })

  app.delete('/pipelines/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    await db.pipeline.delete({ where: { id } })
    reply.code(204).send()
  })

  // Manually run a pipeline: find approved unscheduled posts matching its filter and queue them
  app.post('/pipelines/:id/run', { onRequest: [app.authenticate] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const pipeline = await db.pipeline.findUniqueOrThrow({ where: { id } })
    if (!pipeline.autoPublish || !pipeline.siteIds.length) return { queued: 0, reason: 'no sites or autoPublish disabled' }

    const filter: Record<string, unknown> = {
      approvalStatus: 'APPROVED',
      publishStatus: 'DRAFT',
    }
    if (pipeline.qualityMin > 0) filter['qualityScore'] = { gte: pipeline.qualityMin }

    const sourceFilter = pipeline.sourceFilter as string[] | null
    if (sourceFilter?.length) filter['sourceId'] = { in: sourceFilter }

    const posts = await db.aggregatedPost.findMany({
      where: filter as any,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true },
    })

    let queued = 0
    for (const post of posts) {
      for (const siteId of pipeline.siteIds) {
        const existing = await db.publishTask.findUnique({ where: { postId_siteId: { postId: post.id, siteId } } })
        if (existing) continue
        const task = await db.publishTask.create({
          data: { postId: post.id, siteId, wpStatus: pipeline.defaultStatus },
        })
        await publishQueue.add('publish', { taskId: task.id })
        queued++
      }
    }

    return { queued }
  })
}
