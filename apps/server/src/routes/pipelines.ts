import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { publishQueue } from '../queue.js'
import { socialQueue } from '../workers/socialWorker.js'

const pipelineSchema = z.object({
  name:               z.string().min(1).max(80),
  enabled:            z.boolean().default(true),
  sourceFilter:       z.array(z.string()).nullable().default(null),
  qualityMin:         z.number().int().min(0).max(100).default(0),
  autoPublish:        z.boolean().default(false),
  siteIds:            z.array(z.string()).default([]),
  defaultStatus:      z.enum(['publish', 'draft']).default('publish'),
  schedule:           z.string().nullable().default(null),
  categoryFilter:     z.array(z.string()).default([]),
  translateTo:        z.string().nullable().default(null),
  targetCategory:     z.string().nullable().default(null),
  publishWindowHours: z.number().int().min(0).max(168).default(0),
  aiPrompt:           z.string().max(1000).nullable().default(null),
  sortOrder:          z.number().int().default(0),
  socialAccountId:    z.string().nullable().default(null),
  socialTemplate:     z.enum(['photo_comment', 'link_post', 'photo_only', 'text_link', 'image_overlay']).nullable().default(null),
  languageSiteMapping: z.record(z.array(z.string())).nullable().default(null),
})

export async function pipelinesRoutes(app: FastifyInstance) {
  app.get('/pipelines', { onRequest: [app.authenticate] }, async () => {
    return db.pipeline.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
  })

  app.post('/pipelines', { onRequest: [app.authenticate] }, async (req) => {
    const data = pipelineSchema.parse(req.body)
    return db.pipeline.create({ data: { ...data, sourceFilter: data.sourceFilter ?? undefined, translateTo: data.translateTo ?? undefined, targetCategory: data.targetCategory ?? undefined, aiPrompt: data.aiPrompt ?? undefined, socialAccountId: data.socialAccountId ?? undefined, socialTemplate: data.socialTemplate ?? undefined, languageSiteMapping: data.languageSiteMapping ?? undefined } })
  })

  app.patch('/pipelines/:id', { onRequest: [app.authenticate] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const data = pipelineSchema.partial().parse(req.body)
    return db.pipeline.update({
      where: { id },
      data: {
        ...data,
        sourceFilter:    data.sourceFilter   === null ? undefined : data.sourceFilter,
        translateTo:     data.translateTo    ?? undefined,
        targetCategory:  data.targetCategory ?? undefined,
        aiPrompt:        data.aiPrompt       ?? undefined,
        socialAccountId:     data.socialAccountId     ?? undefined,
        socialTemplate:      data.socialTemplate      ?? undefined,
        languageSiteMapping: data.languageSiteMapping === null ? undefined : data.languageSiteMapping,
      },
    })
  })

  app.delete('/pipelines/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    await db.pipeline.delete({ where: { id } })
    reply.code(204).send()
  })

  app.post('/pipelines/:id/run', { onRequest: [app.authenticate] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const pipeline = await db.pipeline.findUniqueOrThrow({ where: { id } })
    if (!pipeline.autoPublish || !pipeline.siteIds.length) return { queued: 0, reason: 'no sites or autoPublish disabled' }

    const filter: Record<string, unknown> = { publishStatus: 'DRAFT' }
    if (pipeline.qualityMin > 0) filter['qualityScore'] = { gte: pipeline.qualityMin }

    const sourceFilter = pipeline.sourceFilter as string[] | null
    if (sourceFilter?.length) filter['sourceId'] = { in: sourceFilter }

    if (pipeline.categoryFilter?.length) {
      filter['categories'] = { hasSome: pipeline.categoryFilter }
    }

    const posts = await db.aggregatedPost.findMany({
      where: filter as any,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, language: true },
    })

    const languageSiteMapping = pipeline.languageSiteMapping as Record<string, string[]> | null

    const windowMs = pipeline.publishWindowHours > 0 ? pipeline.publishWindowHours * 60 * 60 * 1000 : 0
    let taskIndex = 0
    let queued = 0

    for (const post of posts) {
      let targetSiteIds: string[]
      if (languageSiteMapping && Object.keys(languageSiteMapping).length > 0) {
        const lang = post.language || 'en'
        targetSiteIds = languageSiteMapping[lang] ?? languageSiteMapping['_default'] ?? pipeline.siteIds
      } else {
        targetSiteIds = pipeline.siteIds
      }

      for (const siteId of targetSiteIds) {
        const existing = await db.publishTask.findUnique({ where: { postId_siteId: { postId: post.id, siteId } } })
        if (existing) { taskIndex++; continue }
        const delay = windowMs > 0 ? Math.round((taskIndex / (posts.length * targetSiteIds.length)) * windowMs) : 0
        const task = await db.publishTask.create({
          data: {
            postId: post.id, siteId,
            wpStatus: pipeline.defaultStatus,
            categoryOverride: pipeline.targetCategory ?? null,
          },
        })
        await publishQueue.add('publish-post', {
          publishTaskId: task.id,
          aiPrompt: pipeline.aiPrompt ?? undefined,
        }, delay ? { delay } : undefined)

        if (pipeline.socialAccountId && pipeline.socialTemplate) {
          const account = await db.socialAccount.findUnique({ where: { id: pipeline.socialAccountId } })
          if (account) {
            const socialPost = await db.socialPost.create({
              data: {
                postId:    post.id,
                accountId: pipeline.socialAccountId,
                platform:  account.platform,
                template:  pipeline.socialTemplate,
                status:    'PENDING',
              },
            })
            await socialQueue.add('post', { socialPostId: socialPost.id }, delay ? { delay: delay + 5000 } : undefined)
          }
        }

        queued++
        taskIndex++
      }
    }

    return { queued }
  })
}
