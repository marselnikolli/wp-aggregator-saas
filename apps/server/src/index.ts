import 'dotenv/config'
import { initSentry, Sentry } from './lib/sentry.js'
initSentry()
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import helmet from '@fastify/helmet'
import { ZodError } from 'zod'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { db } from './db.js'
import { redis } from './queue.js'
import { authRoutes } from './routes/auth.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { sitesRoutes } from './routes/sites.js'
import { sourcesRoutes, registerSourceSchedulers } from './routes/sources.js'
import { postsRoutes } from './routes/posts.js'
import { settingsRoutes } from './routes/settings.js'
import { bullboardRoutes } from './routes/bullboard.js'
import { auditRoutes } from './routes/audit.js'
import { metricsRoutes } from './routes/metrics.js'
import { usersRoutes } from './routes/users.js'
import { apiKeysRoutes, resolveApiKey } from './routes/apiKeys.js'
import { startFetchWorker } from './workers/fetcher.js'
import { startPublishWorker } from './workers/publisher.js'
import { startSummarizerWorker } from './workers/summarizer.js'
import { startSchedPublishWorker, applyScheduledPublishSettings } from './workers/schedPublisher.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate:  (req: any, reply: any) => Promise<void>
    requireAdmin:  (req: any, reply: any) => Promise<void>
    requireEditor: (req: any, reply: any) => Promise<void>
  }
}

const app = Fastify({
  logger: { level: config.NODE_ENV === 'production' ? 'warn' : 'info' },
})

async function seedFirstAdmin() {
  const count = await db.user.count()
  if (count > 0) return
  const password = await bcrypt.hash('admin123', 12)
  await db.user.create({ data: { email: 'admin@example.com', password, name: 'Admin' } })
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  First-run admin created:')
  console.log('  Email:    admin@example.com')
  console.log('  Password: admin123')
  console.log('  Change these after first login!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

async function bootstrap() {
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true })
  await app.register(jwt, { secret: config.JWT_SECRET })

  app.decorate('authenticate', async (req: any, reply: any) => {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (bearer.startsWith('wpa_')) {
      const payload = await resolveApiKey(bearer)
      if (!payload) return reply.code(401).send({ error: 'Invalid API key' })
      req.user = payload
      return
    }
    try {
      await req.jwtVerify()
      const jti = (req.user as any)?.jti
      if (jti && await redis.exists(`blocklist:${jti}`)) {
        return reply.code(401).send({ error: 'Session revoked' })
      }
    } catch {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  app.decorate('requireAdmin', async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Admin access required' })
  })

  app.decorate('requireEditor', async (req: any, reply: any) => {
    try { await req.jwtVerify() } catch { return reply.code(401).send({ error: 'Unauthorized' }) }
    if (!['admin', 'editor'].includes(req.user?.role)) return reply.code(403).send({ error: 'Editor access required' })
  })

  // IP allowlist enforcement (skip for health + metrics endpoints)
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url
    if (url === '/health' || url === '/metrics') return
    const row = await db.setting.findUnique({ where: { key: 'ip_allowlist' } }).catch(() => null)
    if (!row?.value) return
    const allowlist: string[] = JSON.parse(row.value)
    if (!allowlist.length) return
    const ip = req.ip
    if (!allowlist.includes(ip)) {
      reply.code(403).send({ error: 'IP not allowed' })
    }
  })

  // Turn ZodErrors into clean 422 responses
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(422).send({
        error: 'Validation error',
        issues: err.flatten().fieldErrors,
      })
    }
    if (reply.statusCode >= 500) Sentry.captureException(err)
    reply.send(err)
  })

  const prefix = '/api'
  await app.register(authRoutes,      { prefix })
  await app.register(dashboardRoutes, { prefix })
  await app.register(sitesRoutes,     { prefix })
  await app.register(sourcesRoutes,   { prefix })
  await app.register(postsRoutes,     { prefix })
  await app.register(settingsRoutes,  { prefix })
  await app.register(auditRoutes,     { prefix })
  await app.register(metricsRoutes)
  await app.register(usersRoutes,     { prefix })
  await app.register(apiKeysRoutes,   { prefix })
  await app.register(bullboardRoutes)

  app.get('/health', () => ({ status: 'ok', ts: new Date() }))

  // Skip workers when a dedicated worker container is running
  if (!process.env.WORKER_ONLY) {
    startFetchWorker()
    startPublishWorker()
    startSummarizerWorker()
    startSchedPublishWorker()
    await registerSourceSchedulers()
    await applyScheduledPublishSettings()
  }

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  await seedFirstAdmin()
  console.log(`Server running on http://localhost:${config.PORT}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
