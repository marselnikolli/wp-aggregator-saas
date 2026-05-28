import { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '../db.js'

const templateBody = z.object({
  name:            z.string().min(1),
  platform:        z.enum(['FACEBOOK', 'INSTAGRAM']),
  language:        z.string().optional().default('sq'),
  includeHashtags: z.boolean().optional().default(true),
  includeExcerpt:  z.boolean().optional().default(false),
  includeContent:  z.boolean().optional().default(false),
  brandingText:    z.string().optional().nullable(),
  emojiStyle:      z.enum(['category', 'none']).optional().default('category'),
  categoryColors:  z.record(z.string()).optional().nullable(),
})

export async function captionTemplatesRoutes(app: FastifyInstance) {
  app.get('/caption-templates', { preHandler: [app.authenticate] }, async () => {
    return db.captionTemplate.findMany({ orderBy: { createdAt: 'desc' } })
  })

  app.post('/caption-templates', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { categoryColors, ...rest } = templateBody.parse(req.body)
    const template = await db.captionTemplate.create({
      data: {
        ...rest,
        categoryColors: categoryColors ?? Prisma.JsonNull,
      },
    })
    return reply.code(201).send(template)
  })

  app.patch('/caption-templates/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const { categoryColors, ...rest } = templateBody.partial().parse(req.body)
    const data: Prisma.CaptionTemplateUpdateInput = { ...rest }
    if (categoryColors !== undefined) data.categoryColors = categoryColors ?? Prisma.JsonNull
    return db.captionTemplate.update({ where: { id }, data })
  })

  app.delete('/caption-templates/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.captionTemplate.delete({ where: { id } })
    return reply.code(204).send()
  })
}
