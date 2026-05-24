import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { encrypt } from '../lib/crypto.js'
import { WPClient } from '../lib/wp-client.js'

const siteBody = z.object({
  name:        z.string().min(1),
  url:         z.string().url(),
  apiUser:     z.string().min(1),
  apiPassword: z.string().min(1),
  enabled:     z.boolean().optional().default(true),
})

export async function sitesRoutes(app: FastifyInstance) {
  app.get('/sites', { preHandler: [app.authenticate] }, async () => {
    return db.site.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, url: true, apiUser: true, enabled: true, lastPublished: true, createdAt: true },
    })
  })

  app.post('/sites', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = siteBody.parse(req.body)
    const site = await db.site.create({
      data: { ...body, apiPassword: encrypt(body.apiPassword) },
      select: { id: true, name: true, url: true, apiUser: true, enabled: true, lastPublished: true, createdAt: true },
    })
    return reply.code(201).send(site)
  })

  app.patch('/sites/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = siteBody.partial().parse(req.body)
    if (body.apiPassword) body.apiPassword = encrypt(body.apiPassword)
    const site = await db.site.update({
      where: { id },
      data: body,
      select: { id: true, name: true, url: true, apiUser: true, enabled: true, lastPublished: true, createdAt: true },
    })
    return site
  })

  app.delete('/sites/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.site.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.post('/sites/:id/test', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const { decrypt } = await import('../lib/crypto.js')
    const site = await db.site.findUniqueOrThrow({ where: { id } })
    const client = new WPClient(site.url, site.apiUser, decrypt(site.apiPassword))
    const ok = await client.testConnection()
    return { ok }
  })
}
