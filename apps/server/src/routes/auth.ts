import { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '../db.js'

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
    const token = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '7d' })
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
}
