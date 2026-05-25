import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { encrypt } from '../lib/crypto.js'
import { WPClient } from '../lib/wp-client.js'

const SITE_SELECT = {
  id: true, name: true, url: true, apiUser: true, enabled: true,
  defaultCategory: true, defaultAuthorId: true,
  lastPublished: true, createdAt: true,
} as const

const siteBody = z.object({
  name:            z.string().min(1),
  url:             z.string().url(),
  apiUser:         z.string().min(1),
  apiPassword:     z.string().min(1),
  enabled:         z.boolean().optional().default(true),
  defaultCategory: z.string().optional().nullable(),
  defaultAuthorId: z.number().int().positive().optional().nullable(),
})

export async function sitesRoutes(app: FastifyInstance) {
  app.get('/sites', { preHandler: [app.authenticate] }, async () => {
    return db.site.findMany({ orderBy: { createdAt: 'desc' }, select: SITE_SELECT })
  })

  app.post('/sites', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = siteBody.parse(req.body)
    const site = await db.site.create({
      data: { ...body, apiPassword: encrypt(body.apiPassword) },
      select: SITE_SELECT,
    })
    return reply.code(201).send(site)
  })

  app.patch('/sites/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = siteBody.partial().parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.apiPassword) data.apiPassword = encrypt(body.apiPassword)
    const site = await db.site.update({ where: { id }, data, select: SITE_SELECT })
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
