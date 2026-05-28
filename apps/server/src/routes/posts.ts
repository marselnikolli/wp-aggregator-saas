import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { publishQueue } from '../queue.js'
import { audit } from '../lib/audit.js'
import { tryOgImageFallback } from '../workers/fetcher.js'

export async function postsRoutes(app: FastifyInstance) {
  app.get('/posts', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({
      page:          z.coerce.number().min(1).default(1),
      per_page:      z.coerce.number().min(1).max(100).default(25),
      publishStatus: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED']).optional(),
      sourceId:      z.string().optional(),
      category:      z.string().optional(),
      dateFrom:      z.string().optional(),
      search:        z.string().optional(),
      language:      z.string().optional(),
    }).parse(req.query)

    const where: any = {
      ...(query.publishStatus && { publishStatus: query.publishStatus }),
      ...(query.sourceId      && { sourceId: query.sourceId }),
      ...(query.category      && { categories: { has: query.category } }),
      ...(query.dateFrom      && { createdAt: { gte: new Date(query.dateFrom) } }),
      ...(query.search        && { title: { contains: query.search, mode: 'insensitive' as const } }),
      ...(query.language      && { language: query.language }),
    }

    const [total, items] = await Promise.all([
      db.aggregatedPost.count({ where }),
      db.aggregatedPost.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { createdAt: 'desc' },
        include: {
          source: { select: { name: true } },
          publishTasks: {
            where: { status: 'DONE' },
            select: {
              wpUrl: true,
              site:  { select: { id: true, name: true, url: true } },
            },
          },
          _count: {
            select: {
              socialPosts:  { where: { status: 'DONE' } },
              publishTasks: { where: { status: 'DONE' } },
            },
          },
        },
      }),
    ])
    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items }
  })

  app.get('/posts/categories', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({ sourceId: z.string().optional() }).parse(req.query)
    const posts = await db.aggregatedPost.findMany({
      select: { categories: true },
      where: { ...(query.sourceId && { sourceId: query.sourceId }) },
    })
    const categories = [...new Set(posts.flatMap(p => p.categories))].filter(Boolean).sort()
    return categories
  })

  app.post('/posts/:id/publish', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

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

  app.post('/posts/bulk-publish', { preHandler: [app.authenticate] }, async (req) => {
    const body = z.object({
      postIds:          z.array(z.string()).min(1),
      siteId:           z.string(),
      categoryOverride: z.string().optional(),
    }).parse(req.body)

    let queued = 0
    for (const postId of body.postIds) {
      const existing = await db.publishTask.findUnique({ where: { postId_siteId: { postId, siteId: body.siteId } } })
      if (existing?.status === 'PENDING' || existing?.status === 'PROCESSING') continue
      const task = await db.publishTask.upsert({
        where: { postId_siteId: { postId, siteId: body.siteId } },
        create: { postId, siteId: body.siteId, status: 'PENDING', categoryOverride: body.categoryOverride ?? null },
        update: { status: 'PENDING', error: null, categoryOverride: body.categoryOverride ?? null },
      })
      await publishQueue.add('publish-post', { publishTaskId: task.id })
      queued++
    }
    return { queued }
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

  // Distinct language codes present in aggregated posts with counts
  app.get('/posts/languages', { preHandler: [app.authenticate] }, async () => {
    const rows = await db.$queryRaw<Array<{ language: string; count: bigint }>>`
      SELECT language, COUNT(*) AS count
      FROM "AggregatedPost"
      WHERE language IS NOT NULL AND language != 'und'
      GROUP BY language
      ORDER BY count DESC
    `
    return rows.map(r => ({ code: r.language, count: Number(r.count) }))
  })

  // Publish task history
  app.get('/publish-tasks', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({
      page:     z.coerce.number().min(1).default(1),
      per_page: z.coerce.number().min(1).max(100).default(25),
      status:   z.enum(['PENDING', 'PROCESSING', 'DONE', 'FAILED']).optional(),
      siteId:   z.string().optional(),
    }).parse(req.query)

    const where: any = {
      ...(query.status && { status: query.status }),
      ...(query.siteId && { siteId: query.siteId }),
    }

    const [total, items] = await Promise.all([
      db.publishTask.count({ where }),
      db.publishTask.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { createdAt: 'desc' },
        include: {
          post: { select: { id: true, title: true, originalUrl: true } },
          site: { select: { id: true, name: true } },
        },
      }),
    ])
    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items }
  })

  // Bulk re-fetch missing featured images via og:image scrape
  app.post('/posts/bulk-refetch-images', { preHandler: [app.authenticate] }, async (req) => {
    const body = z.object({
      sourceId: z.string().optional(),
    }).parse(req.body)

    const posts = await db.aggregatedPost.findMany({
      where: {
        imageUrl: null,
        ...(body.sourceId ? { sourceId: body.sourceId } : {}),
        originalUrl: { not: null },
      },
      take: 100,
      select: { id: true, originalUrl: true },
    })

    let updated = 0
    let failed = 0
    for (const post of posts) {
      try {
        const result = await tryOgImageFallback(post.id, post.originalUrl!)
        if (result) updated++
        else failed++
      } catch {
        failed++
      }
    }

    return { processed: posts.length, updated, failed }
  })

  // Retry a failed publish task
  app.post('/publish-tasks/:id/retry', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const task = await db.publishTask.findUniqueOrThrow({ where: { id } })
    if (task.status !== 'FAILED') {
      return reply.code(422).send({ error: 'Only FAILED tasks can be retried' })
    }
    await db.publishTask.update({
      where: { id },
      data: { status: 'PENDING', error: null },
    })
    await publishQueue.add('publish-post', { publishTaskId: id })
    return { queued: true }
  })
}
