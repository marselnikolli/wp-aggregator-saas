import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { publishQueue } from '../queue.js'
import { audit } from '../lib/audit.js'

export async function dedupRoutes(app: FastifyInstance) {
  app.get('/dedup', { onRequest: [app.authenticate] }, async (req) => {
    const query = z.object({
      page:     z.coerce.number().min(1).default(1),
      per_page: z.coerce.number().min(1).max(100).default(25),
    }).parse(req.query)

    const where = { semanticDupOf: { not: null } }

    const [total, items] = await Promise.all([
      db.aggregatedPost.count({ where }),
      db.aggregatedPost.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { createdAt: 'desc' },
        include: {
          source: { select: { name: true } },
        },
      }),
    ])

    const withParent = await Promise.all(
      items.map(async (post) => {
        let parent = null
        if (post.semanticDupOf) {
          parent = await db.aggregatedPost.findUnique({
            where: { id: post.semanticDupOf },
            select: { id: true, title: true, originalUrl: true, createdAt: true },
          })
        }
        return { ...post, parent }
      })
    )

    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items: withParent }
  })

  app.post('/dedup/:id/mark-unique', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const jwt = req.user as { sub: string; email?: string }

    const post = await db.aggregatedPost.findUniqueOrThrow({ where: { id } })
    if (!post.semanticDupOf) {
      return reply.code(422).send({ error: 'Post is not marked as a duplicate' })
    }

    await db.aggregatedPost.update({
      where: { id },
      data: {
        semanticDupOf: null,
        publishStatus: 'DRAFT',
      },
    })

    await db.publishTask.deleteMany({
      where: { postId: id, status: { in: ['PENDING', 'PROCESSING'] } },
    })

    audit('dedup.mark-unique', {
      userId: jwt.sub,
      userEmail: jwt.email,
      resourceType: 'post',
      resourceId: id,
      metadata: { title: post.title, wasDupOf: post.semanticDupOf },
    })

    return { ok: true }
  })
}
