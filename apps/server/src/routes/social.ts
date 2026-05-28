import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { socialQueue } from '../workers/socialWorker.js'
import { generateCaption } from '../lib/caption.js'

const templateEnum = z.enum(['photo_comment', 'link_post', 'photo_only', 'text_link', 'image_overlay'])

export async function socialRoutes(app: FastifyInstance) {
  app.post('/social/publish', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      postId:           z.string(),
      accountId:        z.string(),
      template:         templateEnum,
      scheduledAt:      z.string().datetime().optional(),
      captionTemplateId: z.string().optional(),
    }).parse(req.body)

    const account = await db.socialAccount.findUniqueOrThrow({ where: { id: body.accountId } })

    if (!account.siteId) {
      return reply.code(422).send({ error: 'Social account must be linked to a destination site before sharing' })
    }

    const publishTask = await db.publishTask.findUnique({
      where:  { postId_siteId: { postId: body.postId, siteId: account.siteId } },
      select: { status: true },
    })
    if (!publishTask || publishTask.status !== 'DONE') {
      return reply.code(422).send({
        error: 'Post must be published to the destination site before sharing to social media. Publish the post first.',
      })
    }

    const status = body.scheduledAt ? 'SCHEDULED' : 'PENDING'
    const record = await db.socialPost.create({
      data: {
        postId:           body.postId,
        accountId:        body.accountId,
        platform:         account.platform,
        template:         body.template,
        captionTemplateId: body.captionTemplateId ?? null,
        status,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      },
    })

    const delay = body.scheduledAt
      ? Math.max(0, new Date(body.scheduledAt).getTime() - Date.now())
      : undefined

    await socialQueue.add('post', { socialPostId: record.id }, delay ? { delay } : {})

    return reply.code(201).send(record)
  })

  app.post('/social/bulk-publish', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      postIds:   z.array(z.string()).min(1),
      accountId: z.string(),
      template:  templateEnum,
    }).parse(req.body)

    const account = await db.socialAccount.findUniqueOrThrow({ where: { id: body.accountId } })

    if (!account.siteId) {
      return reply.code(422).send({ error: 'Social account must be linked to a destination site before sharing' })
    }

    let enqueued = 0
    for (const postId of body.postIds) {
      const task = await db.publishTask.findUnique({
        where:  { postId_siteId: { postId, siteId: account.siteId } },
        select: { status: true },
      })
      if (!task || task.status !== 'DONE') continue
      const record = await db.socialPost.create({
        data: {
          postId,
          accountId: body.accountId,
          platform:  account.platform,
          template:  body.template,
          status:    'PENDING',
        },
      })
      await socialQueue.add('post', { socialPostId: record.id })
      enqueued++
    }

    return reply.code(200).send({ enqueued })
  })

  app.get('/social/history', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({
      platform:  z.enum(['FACEBOOK', 'INSTAGRAM']).optional(),
      accountId: z.string().optional(),
      status:    z.enum(['PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SCHEDULED', 'CANCELLED']).optional(),
      page:      z.coerce.number().min(1).default(1),
      limit:     z.coerce.number().min(1).max(100).default(20),
    }).parse(req.query)

    const where: any = {
      ...(query.platform  && { platform: query.platform }),
      ...(query.accountId && { accountId: query.accountId }),
      ...(query.status    && { status: query.status }),
    }

    const [total, items] = await Promise.all([
      db.socialPost.count({ where }),
      db.socialPost.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          post:    { select: { id: true, title: true, imageUrl: true } },
          account: { select: { id: true, name: true, platform: true } },
        },
      }),
    ])

    return { items, total, page: query.page, pages: Math.ceil(total / query.limit) }
  })

  app.post('/social/history/:id/retry', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const record = await db.socialPost.update({
      where: { id },
      data: { status: 'PENDING', error: null },
    })

    await socialQueue.add('post', { socialPostId: record.id })

    return reply.send(record)
  })

  app.delete('/social/history/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const record = await db.socialPost.findUniqueOrThrow({ where: { id } })

    if (record.status !== 'SCHEDULED' && record.status !== 'PENDING') {
      return reply.code(400).send({ error: 'Only SCHEDULED or PENDING posts can be deleted' })
    }

    await db.socialPost.delete({ where: { id } })

    return reply.code(204).send()
  })

  app.get('/social/analytics', { preHandler: [app.authenticate] }, async () => {
    const [total, done, failed, byPlatformRaw, byTemplateRaw, recent] = await Promise.all([
      db.socialPost.count(),
      db.socialPost.count({ where: { status: 'DONE' } }),
      db.socialPost.count({ where: { status: 'FAILED' } }),
      db.socialPost.groupBy({ by: ['platform'], _count: { _all: true } }),
      db.socialPost.groupBy({ by: ['template'], _count: { _all: true } }),
      db.socialPost.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const byPlatform: Record<string, number> = { FACEBOOK: 0, INSTAGRAM: 0 }
    for (const row of byPlatformRaw) {
      byPlatform[row.platform] = row._count._all
    }

    const byTemplate: Record<string, number> = {}
    for (const row of byTemplateRaw) {
      byTemplate[row.template] = row._count._all
    }

    const dailyMap = new Map<string, number>()
    for (const { createdAt } of recent) {
      const date = createdAt.toISOString().slice(0, 10)
      dailyMap.set(date, (dailyMap.get(date) ?? 0) + 1)
    }
    const last30Days = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))

    return { total, done, failed, byPlatform, byTemplate, last30Days }
  })

  app.get('/social/analytics/top', { preHandler: [app.authenticate] }, async () => {
    const items = await db.socialPost.findMany({
      where:   { engagement: { not: null } },
      orderBy: { engagement: 'desc' },
      take:    10,
      include: {
        post:    { select: { title: true } },
        account: { select: { name: true } },
      },
    })
    return items
  })

  app.post('/social/preview-caption', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      postId:           z.string(),
      accountId:        z.string(),
      template:         templateEnum,
      captionTemplateId: z.string().optional(),
    }).parse(req.body)

    const [post, account] = await Promise.all([
      db.aggregatedPost.findUniqueOrThrow({ where: { id: body.postId } }),
      db.socialAccount.findUniqueOrThrow({ where: { id: body.accountId }, select: { platform: true, siteId: true } }),
    ])
    const tmpl = body.captionTemplateId
      ? await db.captionTemplate.findUnique({ where: { id: body.captionTemplateId } })
      : await db.captionTemplate.findFirst({ where: { platform: account.platform } })

    // Resolve best available URL: WP site URL if published, else originalUrl
    let postUrl = post.originalUrl ?? ''
    if (account.siteId) {
      const task = await db.publishTask.findUnique({
        where:  { postId_siteId: { postId: body.postId, siteId: account.siteId } },
        select: { status: true, wpUrl: true },
      })
      if (task?.status === 'DONE' && task.wpUrl) postUrl = task.wpUrl
    }

    const caption = generateCaption({
      title:           post.title,
      categories:      post.categories,
      aiTags:          post.aiTags,
      originalUrl:     postUrl,
      language:        tmpl?.language ?? 'sq',
      includeHashtags: tmpl?.includeHashtags ?? true,
      includeExcerpt:  tmpl?.includeExcerpt  ?? false,
      excerpt:         post.excerpt ?? undefined,
      includeContent:  tmpl?.includeContent  ?? false,
      content:         post.content ?? undefined,
      brandingText:    tmpl?.brandingText    ?? undefined,
      emojiStyle:      (tmpl?.emojiStyle as 'category' | 'none') ?? 'category',
    })

    const previewCaption = body.template === 'photo_comment'
      ? `Lexo lajmin e plotë në: ${postUrl}`
      : caption

    return reply.send({ caption: previewCaption })
  })
}
