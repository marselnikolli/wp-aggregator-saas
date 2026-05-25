import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { generateSecret, generateURI, verify as totpVerify } from 'otplib'
import qrcode from 'qrcode'
import { db } from '../db.js'
import { redis } from '../queue.js'
import { audit } from '../lib/audit.js'

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
  totpCode: z.string().optional(),
})

async function issueToken(app: FastifyInstance, user: { id: string; role: string; email: string }, req: any) {
  const jti = randomUUID()
  const token = app.jwt.sign({ sub: user.id, role: user.role, email: user.email, jti }, { expiresIn: '7d' })
  await redis.set(
    `session:${jti}`,
    JSON.stringify({ userId: user.id, email: user.email, ip: req.ip, ua: req.headers['user-agent'] ?? '' }),
    'EX', 7 * 24 * 3600,
  )
  return token
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body)
    const user = await db.user.findUnique({ where: { email: body.email } })
    if (!user || !(await bcrypt.compare(body.password, user.password))) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    if (user.totpEnabled && user.totpSecret) {
      if (!body.totpCode) {
        return reply.code(200).send({ totpRequired: true })
      }
      const valid = await totpVerify({ secret: user.totpSecret, token: body.totpCode, strategy: 'totp' })
      if (!valid) return reply.code(401).send({ error: 'Invalid 2FA code' })
    }

    const token = await issueToken(app, user, req)
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
      select: { id: true, email: true, name: true, role: true, totpEnabled: true },
    })
  })

  // --- TOTP 2FA routes ---

  app.post('/auth/totp/setup', { preHandler: [app.authenticate] }, async (req) => {
    const jwt = req.user as { sub: string; email?: string }
    const secret = generateSecret({ length: 20 })
    await db.user.update({ where: { id: jwt.sub }, data: { totpSecret: secret, totpEnabled: false } })
    const otpauthUrl = generateURI({ strategy: 'totp', issuer: 'WP Aggregator', label: jwt.email ?? jwt.sub, secret })
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl)
    return { secret, qrDataUrl }
  })

  // Verify the code from the authenticator app and enable TOTP
  app.post('/auth/totp/enable', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { code } = z.object({ code: z.string().length(6) }).parse(req.body)
    const jwt = req.user as { sub: string }
    const user = await db.user.findUniqueOrThrow({ where: { id: jwt.sub } })
    if (!user.totpSecret) return reply.code(400).send({ error: 'Call /auth/totp/setup first' })
    const valid = await totpVerify({ secret: user.totpSecret, token: code, strategy: 'totp' })
    if (!valid) return reply.code(401).send({ error: 'Invalid code' })
    await db.user.update({ where: { id: jwt.sub }, data: { totpEnabled: true } })
    audit('auth.totp.enable', { userId: jwt.sub, metadata: {} })
    return { enabled: true }
  })

  app.post('/auth/totp/disable', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { code } = z.object({ code: z.string().length(6) }).parse(req.body)
    const jwt = req.user as { sub: string }
    const user = await db.user.findUniqueOrThrow({ where: { id: jwt.sub } })
    if (!user.totpEnabled || !user.totpSecret) {
      return reply.code(400).send({ error: '2FA is not enabled' })
    }
    const valid = await totpVerify({ secret: user.totpSecret, token: code, strategy: 'totp' })
    if (!valid) return reply.code(401).send({ error: 'Invalid code' })
    await db.user.update({ where: { id: jwt.sub }, data: { totpEnabled: false, totpSecret: null } })
    audit('auth.totp.disable', { userId: jwt.sub, metadata: {} })
    return { enabled: false }
  })

  // --- Session management ---

  app.get('/auth/sessions', { preHandler: [app.authenticate] }, async (req) => {
    const jwt = req.user as { sub: string }
    const currentJti = (req.user as any).jti
    const keys = await redis.keys(`session:*`)
    const sessions = []
    for (const key of keys) {
      const raw = await redis.get(key)
      if (!raw) continue
      const data = JSON.parse(raw)
      if (data.userId !== jwt.sub) continue
      const jti = key.replace('session:', '')
      const ttl = await redis.ttl(key)
      sessions.push({ jti, ip: data.ip, ua: data.ua, expiresIn: ttl, current: jti === currentJti })
    }
    return sessions
  })

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
