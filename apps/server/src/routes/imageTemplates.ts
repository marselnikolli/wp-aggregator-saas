import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { uploadImage } from '../lib/image-storage.js'
import { generateSocialImageFromTemplate } from '../lib/social-image.js'
import { writeFile } from 'fs/promises'

const createBody = z.object({
  name:     z.string().min(1),
  platform: z.enum(['FACEBOOK', 'INSTAGRAM']),
  elements: z.array(z.any()),
})

const patchBody = createBody.partial()

const logoBody = z.object({
  logoBase64: z.string().min(1),
  mimeType:   z.enum(['image/png', 'image/svg+xml']),
})

const previewBody = z.object({
  postId: z.string().min(1),
})

export async function imageTemplatesRoutes(app: FastifyInstance) {
  // GET /image-templates
  app.get('/image-templates', { preHandler: [app.authenticate] }, async () => {
    return db.imageTemplate.findMany({ orderBy: { createdAt: 'desc' } })
  })

  // POST /image-templates
  app.post('/image-templates', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = createBody.parse(req.body)
    const template = await db.imageTemplate.create({ data })
    return reply.code(201).send(template)
  })

  // PATCH /image-templates/:id
  app.patch('/image-templates/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const data = patchBody.parse(req.body)
    return db.imageTemplate.update({ where: { id }, data })
  })

  // DELETE /image-templates/:id
  app.delete('/image-templates/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.imageTemplate.delete({ where: { id } })
    return reply.code(204).send()
  })

  // POST /image-templates/:id/logo — accepts base64-encoded logo, uploads it, stores URL
  app.post('/image-templates/:id/logo', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { logoBase64, mimeType } = logoBody.parse(req.body)

    const buffer = Buffer.from(logoBase64, 'base64')
    let logoUrl = await uploadImage(buffer, mimeType, `logo-${id}`)

    if (!logoUrl) {
      // S3 not configured — write to /tmp
      const ext = mimeType === 'image/svg+xml' ? 'svg' : 'png'
      const tmpPath = `/tmp/logo-${id}.${ext}`
      await writeFile(tmpPath, buffer)
      logoUrl = `file://${tmpPath}`
    }

    const updated = await db.imageTemplate.update({
      where: { id },
      data:  { logoUrl },
    })

    return { logoUrl: updated.logoUrl }
  })

  // POST /image-templates/:id/preview — generates JPEG image from template + post data
  app.post('/image-templates/:id/preview', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { postId } = previewBody.parse(req.body)

    const [template, post] = await Promise.all([
      db.imageTemplate.findUniqueOrThrow({ where: { id } }),
      db.aggregatedPost.findUniqueOrThrow({ where: { id: postId } }),
    ])

    // Try to get category colours from the first matching caption template for this platform
    const captionTpl = await db.captionTemplate.findFirst({
      where: { platform: template.platform },
    })
    const categoryColors: Record<string, string> =
      (captionTpl?.categoryColors as Record<string, string> | null) ?? {}

    const buffer = await generateSocialImageFromTemplate({
      post: {
        title:      post.aiTitle ?? post.title,
        categories: post.categories,
        imageUrl:   post.imageUrl,
      },
      template: {
        elements: template.elements as any[],
        logoUrl:  template.logoUrl,
      },
      categoryColors,
    })

    return reply
      .header('Content-Type', 'image/jpeg')
      .send(buffer)
  })
}
