import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'

const templateBody = z.object({
  name:            z.string().min(1),
  platform:        z.enum(['FACEBOOK', 'INSTAGRAM']),
  language:        z.string().optional().default('sq'),
  includeHashtags: z.boolean().optional().default(true),
  includeExcerpt:  z.boolean().optional().default(false),
  brandingText:    z.string().optional().nullable(),
  emojiStyle:      z.enum(['category', 'none']).optional().default('category'),
  categoryColors:  z.record(z.string()).optional().nullable(),
})

export async function captionTemplatesRoutes(app: FastifyInstance) {
  app.get('/caption-templates', { preHandler: [app.authenticate] }, async () => {
    return db.captionTemplate.findMany({ orderBy: { createdAt: 'desc' } })
  })

  app.post('/caption-templates', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = templateBody.parse(req.body)
    const template = await db.captionTemplate.create({ data: body })
    return reply.code(201).send(template)
  })

  app.patch('/caption-templates/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const body = templateBody.partial().parse(req.body)
    return db.captionTemplate.update({ where: { id }, data: body })
  })

  app.delete('/caption-templates/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.captionTemplate.delete({ where: { id } })
    return reply.code(204).send()
  })
}
