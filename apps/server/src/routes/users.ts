import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '../db.js'

export async function usersRoutes(app: FastifyInstance) {
  // List users (admin only)
  app.get('/users', { preHandler: [app.requireAdmin] }, async () => {
    return db.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  })

  // Create user (admin only)
  app.post('/users', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const body = z.object({
      email:    z.string().email(),
      password: z.string().min(6),
      name:     z.string().optional(),
      role:     z.enum(['admin', 'editor', 'viewer']).default('editor'),
    }).parse(req.body)

    const existing = await db.user.findUnique({ where: { email: body.email } })
    if (existing) return reply.code(409).send({ error: 'Email already in use' })

    const hash = await bcrypt.hash(body.password, 12)
    return db.user.create({
      data: { email: body.email, password: hash, name: body.name, role: body.role },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    })
  })

  // Update user role/name (admin only)
  app.patch('/users/:id', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      name:     z.string().optional(),
      role:     z.enum(['admin', 'editor', 'viewer']).optional(),
      password: z.string().min(6).optional(),
    }).parse(req.body)

    const jwt = req.user as { sub: string }
    // Prevent self-demotion from admin
    if (id === jwt.sub && body.role && body.role !== 'admin') {
      return reply.code(422).send({ error: 'Cannot remove your own admin role' })
    }

    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.role !== undefined) data.role = body.role
    if (body.password) data.password = await bcrypt.hash(body.password, 12)

    return db.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true },
    })
  })

  // Delete user (admin only, cannot self-delete)
  app.delete('/users/:id', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const jwt = req.user as { sub: string }
    if (id === jwt.sub) return reply.code(422).send({ error: 'Cannot delete your own account' })
    await db.user.delete({ where: { id } })
    return reply.code(204).send()
  })
}
