import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { db } from '../db.js'
import { redis } from '../queue.js'
import { audit } from '../lib/audit.js'

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
})

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body)
    const user = await db.user.findUnique({ where: { email: body.email } })
    if (!user || !(await bcrypt.compare(body.password, user.password))) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    const jti = randomUUID()
    const token = app.jwt.sign({ sub: user.id, role: user.role, email: user.email, jti }, { expiresIn: '7d' })
    // Track session in Redis (7d TTL)
    await redis.set(`session:${jti}`, JSON.stringify({ userId: user.id, email: user.email, ip: req.ip, ua: req.headers['user-agent'] ?? '' }), 'EX', 7 * 24 * 3600)
    audit('auth.login', { userId: user.id, userEmail: user.email, metadata: { ip: req.ip } })
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } }
  })

  app.post('/auth/register', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const body = loginSchema.extend({ name: z.string().optional() }).parse(req.body)
    const existing = await db.user.findUnique({ where: { email: body.email } })
    if (existing) return reply.code(409).send({ error: 'Email already in use' })
    const hash = await bcrypt.hash(body.password, 12)
    const user = await db.user.create({
      data: { email: body.email, password: hash, name: body.name },
      select: { id: true, email: true, name: true, role: true },
    })
    return user
  })

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    const jwt = req.user as { sub: string }
    return db.user.findUniqueOrThrow({
      where: { id: jwt.sub },
      select: { id: true, email: true, name: true, role: true },
    })
  })

  // List active sessions for current user
  app.get('/auth/sessions', { preHandler: [app.authenticate] }, async (req) => {
    const jwt = req.user as { sub: string }
    const keys = await redis.keys(`session:*`)
    const sessions = []
    for (const key of keys) {
      const raw = await redis.get(key)
      if (!raw) continue
      const data = JSON.parse(raw)
      if (data.userId !== jwt.sub) continue
      const jti = key.replace('session:', '')
      const ttl = await redis.ttl(key)
      sessions.push({ jti, ip: data.ip, ua: data.ua, expiresIn: ttl })
    }
    return sessions
  })

  // Revoke a session by jti
  app.delete('/auth/sessions/:jti', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { jti } = req.params as { jti: string }
    const jwt = req.user as { sub: string }
    const raw = await redis.get(`session:${jti}`)
    if (!raw) return reply.code(404).send({ error: 'Session not found' })
    const data = JSON.parse(raw)
    if (data.userId !== jwt.sub) return reply.code(403).send({ error: 'Not your session' })
    await redis.del(`session:${jti}`)
    await redis.set(`blocklist:${jti}`, '1', 'EX', 7 * 24 * 3600)
    return reply.code(204).send()
  })
}
