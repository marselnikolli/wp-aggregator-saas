import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createHash, randomBytes } from 'crypto'
import { db } from '../db.js'

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function apiKeysRoutes(app: FastifyInstance) {
  // List API keys for current user (hashes never returned)
  app.get('/api-keys', { preHandler: [app.authenticate] }, async (req) => {
    const jwt = req.user as { sub: string }
    return db.apiKey.findMany({
      where: { userId: jwt.sub },
      select: { id: true, name: true, lastUsed: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
  })

  // Generate new API key — raw value returned ONCE
  app.post('/api-keys', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { name } = z.object({ name: z.string().min(1).max(60) }).parse(req.body)
    const jwt = req.user as { sub: string }

    const raw = `wpa_${randomBytes(32).toString('hex')}`
    const key = await db.apiKey.create({
      data: { userId: jwt.sub, name, keyHash: hashKey(raw) },
      select: { id: true, name: true, createdAt: true },
    })

    return reply.code(201).send({ ...key, key: raw })
  })

  // Delete API key
  app.delete('/api-keys/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const jwt = req.user as { sub: string }
    await db.apiKey.deleteMany({ where: { id, userId: jwt.sub } })
    return reply.code(204).send()
  })
}

// Called from authenticate middleware — checks Authorization: Bearer wpa_xxx
export async function resolveApiKey(raw: string): Promise<{ sub: string; role: string; email: string } | null> {
  if (!raw.startsWith('wpa_')) return null
  const hash = hashKey(raw)
  const key = await db.apiKey.findUnique({
    where: { keyHash: hash },
    include: { user: { select: { id: true, role: true, email: true } } },
  })
  if (!key) return null
  // Non-blocking last-used update
  db.apiKey.update({ where: { id: key.id }, data: { lastUsed: new Date() } }).catch(() => {})
  return { sub: key.user.id, role: key.user.role, email: key.user.email }
}
