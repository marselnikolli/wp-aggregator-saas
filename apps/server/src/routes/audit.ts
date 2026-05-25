import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit-log', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({
      page:         z.coerce.number().min(1).default(1),
      per_page:     z.coerce.number().min(1).max(100).default(50),
      action:       z.string().optional(),
      resourceType: z.string().optional(),
      userId:       z.string().optional(),
    }).parse(req.query)

    const where: any = {
      ...(query.action       && { action: query.action }),
      ...(query.resourceType && { resourceType: query.resourceType }),
      ...(query.userId       && { userId: query.userId }),
    }

    const [total, items] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        skip:    (query.page - 1) * query.per_page,
        take:    query.per_page,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items }
  })
}
