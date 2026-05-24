import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import helmet from '@fastify/helmet'
import { ZodError } from 'zod'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { db } from './db.js'
import { authRoutes } from './routes/auth.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { sitesRoutes } from './routes/sites.js'
import { sourcesRoutes } from './routes/sources.js'
import { postsRoutes } from './routes/posts.js'
import { startFetchWorker } from './workers/fetcher.js'
import { startPublishWorker } from './workers/publisher.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>
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
    try {
      await req.jwtVerify()
    } catch {
      reply.code(401).send({ error: 'Unauthorized' })
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
    reply.send(err)
  })

  const prefix = '/api'
  await app.register(authRoutes,      { prefix })
  await app.register(dashboardRoutes, { prefix })
  await app.register(sitesRoutes,     { prefix })
  await app.register(sourcesRoutes,   { prefix })
  await app.register(postsRoutes,     { prefix })

  app.get('/health', () => ({ status: 'ok', ts: new Date() }))

  startFetchWorker()
  startPublishWorker()

  await app.listen({ port: config.PORT, host: '0.0.0.0' })
  await seedFirstAdmin()
  console.log(`Server running on http://localhost:${config.PORT}`)
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
