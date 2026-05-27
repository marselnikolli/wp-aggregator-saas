import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { encrypt, decrypt } from '../lib/crypto.js'

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  platform: true,
  pageId: true,
  siteId: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { socialPosts: true } },
} as const

const createBody = z.object({
  name:        z.string().min(1),
  platform:    z.enum(['FACEBOOK', 'INSTAGRAM']),
  pageId:      z.string().min(1),
  accessToken: z.string().min(1),
  siteId:      z.string().optional().nullable(),
  enabled:     z.boolean().optional().default(true),
})

const updateBody = createBody.partial()

export async function socialAccountsRoutes(app: FastifyInstance) {
  app.get('/social-accounts', { preHandler: [app.authenticate] }, async () => {
    return db.socialAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select: ACCOUNT_SELECT,
    })
  })

  app.post('/social-accounts', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = createBody.parse(req.body)
    const account = await db.socialAccount.create({
      data: {
        ...body,
        accessToken: encrypt(body.accessToken),
      },
      select: ACCOUNT_SELECT,
    })
    return reply.code(201).send(account)
  })

  app.patch('/social-accounts/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const body = updateBody.parse(req.body)
    const data: Record<string, unknown> = { ...body }
    if (body.accessToken) data.accessToken = encrypt(body.accessToken)
    return db.socialAccount.update({
      where: { id },
      data,
      select: ACCOUNT_SELECT,
    })
  })

  app.delete('/social-accounts/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.socialAccount.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.post('/social-accounts/:id/test', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const account = await db.socialAccount.findUniqueOrThrow({ where: { id } })
    const token = decrypt(account.accessToken)
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${token}`,
      )
      const json = (await res.json()) as { id?: string; name?: string; error?: { message?: string } }
      if (!res.ok) {
        return { ok: false, error: json.error?.message ?? 'Unknown error' }
      }
      return { ok: true, name: json.name, id: json.id }
    } catch {
      return { ok: false, error: 'Network error' }
    }
  })
}
