import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { publishQueue } from '../queue.js'
import { audit } from '../lib/audit.js'

export async function postsRoutes(app: FastifyInstance) {
  app.get('/posts', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({
      page:           z.coerce.number().min(1).default(1),
      per_page:       z.coerce.number().min(1).max(100).default(25),
      approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
      publishStatus:  z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED']).optional(),
      sourceId:       z.string().optional(),
      category:       z.string().optional(),
      dateFrom:       z.string().optional(),
      search:         z.string().optional(),
    }).parse(req.query)

    const where: any = {
      ...(query.approvalStatus && { approvalStatus: query.approvalStatus }),
      ...(query.publishStatus  && { publishStatus: query.publishStatus }),
      ...(query.sourceId       && { sourceId: query.sourceId }),
      ...(query.category       && { categories: { has: query.category } }),
      ...(query.dateFrom       && { createdAt: { gte: new Date(query.dateFrom) } }),
      ...(query.search         && { title: { contains: query.search, mode: 'insensitive' as const } }),
    }

    const [total, items] = await Promise.all([
      db.aggregatedPost.count({ where }),
      db.aggregatedPost.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { createdAt: 'desc' },
        include: { source: { select: { name: true } } },
      }),
    ])
    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items }
  })

  // Returns unique category names, optionally scoped to a source
  app.get('/posts/categories', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({ sourceId: z.string().optional() }).parse(req.query)

    const posts = await db.aggregatedPost.findMany({
      select: { categories: true },
      where: {
        ...(query.sourceId && { sourceId: query.sourceId }),
      },
    })
    const categories = [...new Set(posts.flatMap(p => p.categories))].filter(Boolean).sort()
    return categories
  })

  app.patch('/posts/:id/approve', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const jwt = req.user as { sub: string; email?: string }
    const post = await db.aggregatedPost.update({ where: { id }, data: { approvalStatus: 'APPROVED' } })
    audit('post.approve', { userId: jwt.sub, userEmail: jwt.email, resourceType: 'post', resourceId: id, metadata: { title: post.title } })
    return post
  })

  app.patch('/posts/:id/reject', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const jwt = req.user as { sub: string; email?: string }
    const post = await db.aggregatedPost.update({ where: { id }, data: { approvalStatus: 'REJECTED' } })
    audit('post.reject', { userId: jwt.sub, userEmail: jwt.email, resourceType: 'post', resourceId: id, metadata: { title: post.title } })
    return post
  })

  app.post('/posts/:id/publish', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    // Support both legacy { siteIds } and new { sites: [{ siteId, wpStatus, categoryOverride, tagOverrides }] }
    const legacySchema = z.object({
      siteIds:       z.array(z.string()).min(1),
      wpStatus:      z.enum(['publish', 'draft', 'future']).default('publish'),
      scheduledDate: z.string().datetime().optional(),
    })
    const perSiteSchema = z.object({
      sites: z.array(z.object({
        siteId:           z.string(),
        wpStatus:         z.enum(['publish', 'draft', 'future']).default('publish'),
        scheduledDate:    z.string().datetime().optional(),
        categoryOverride: z.string().optional(),
        tagOverrides:     z.array(z.string()).optional(),
      })).min(1),
    })

    type SiteTarget = { siteId: string; wpStatus: 'publish' | 'draft' | 'future'; scheduledDate?: string; categoryOverride?: string; tagOverrides?: string[] }
    let targets: SiteTarget[]
    try {
      const p = perSiteSchema.parse(req.body)
      targets = p.sites
    } catch {
      const p = legacySchema.parse(req.body)
      targets = p.siteIds.map(siteId => ({ siteId, wpStatus: p.wpStatus, scheduledDate: p.scheduledDate }))
    }

    for (const t of targets) {
      if (t.wpStatus === 'future' && !t.scheduledDate) {
        return reply.code(422).send({ error: `scheduledDate required for site ${t.siteId} when wpStatus is "future"` })
      }
    }

    const post = await db.aggregatedPost.findUniqueOrThrow({ where: { id } })
    if (post.approvalStatus !== 'APPROVED') {
      return reply.code(422).send({ error: 'Post must be approved before publishing' })
    }

    const jwt = req.user as { sub: string; email?: string }
    const tasks = await Promise.all(
      targets.map(async (t) => {
        const task = await db.publishTask.upsert({
          where: { postId_siteId: { postId: id, siteId: t.siteId } },
          create: {
            postId: id, siteId: t.siteId, status: 'PENDING',
            wpStatus:         t.wpStatus,
            scheduledDate:    t.scheduledDate ? new Date(t.scheduledDate) : null,
            categoryOverride: t.categoryOverride ?? null,
            tagOverrides:     t.tagOverrides ?? [],
          },
          update: {
            status: 'PENDING', error: null,
            wpStatus:         t.wpStatus,
            scheduledDate:    t.scheduledDate ? new Date(t.scheduledDate) : null,
            categoryOverride: t.categoryOverride ?? null,
            tagOverrides:     t.tagOverrides ?? [],
          },
        })
        await publishQueue.add('publish-post', { publishTaskId: task.id })
        return task.id
      })
    )
    audit('post.publish', {
      userId: jwt.sub, userEmail: jwt.email, resourceType: 'post', resourceId: id,
      metadata: { siteIds: targets.map(t => t.siteId), title: post.title },
    })
    return { queued: tasks.length, taskIds: tasks }
  })

  app.patch('/posts/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({
      title:   z.string().min(1).optional(),
      excerpt: z.string().optional(),
      content: z.string().optional(),
    }).parse(req.body)
    return db.aggregatedPost.update({ where: { id }, data: body })
  })

  app.delete('/posts/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const jwt = req.user as { sub: string; email?: string }
    const post = await db.aggregatedPost.findUnique({ where: { id }, select: { title: true } })
    await db.aggregatedPost.delete({ where: { id } })
    audit('post.delete', { userId: jwt.sub, userEmail: jwt.email, resourceType: 'post', resourceId: id, metadata: { title: post?.title } })
    return reply.code(204).send()
  })
}
