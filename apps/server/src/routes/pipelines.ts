import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { publishQueue } from '../queue.js'
import { socialQueue } from '../workers/socialWorker.js'

const categoryMappingSchema = z.object({
  sourceId:         z.string(),
  sourceCategory:   z.string(),
  destCategoryId:   z.number().int().nullable(),
  destCategoryName: z.string().nullable(),
})

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
  postLimit:          z.number().int().min(1).max(500).default(50),
  aiPrompt:           z.string().max(1000).nullable().default(null),
  sortOrder:          z.number().int().default(0),
  socialAccountId:    z.string().nullable().default(null),
  socialTemplate:     z.enum(['photo_comment', 'link_post', 'photo_only', 'text_link', 'image_overlay']).nullable().default(null),
  languageSiteMapping: z.record(z.array(z.string())).nullable().default(null),
  categoryMappings:   z.array(categoryMappingSchema).nullable().default(null),
})

export async function pipelinesRoutes(app: FastifyInstance) {
  app.get('/pipelines', { onRequest: [app.authenticate] }, async () => {
    return db.pipeline.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] })
  })

  app.post('/pipelines', { onRequest: [app.authenticate] }, async (req) => {
    const data = pipelineSchema.parse(req.body)
    return db.pipeline.create({
      data: {
        ...data,
        sourceFilter:        data.sourceFilter        ?? undefined,
        translateTo:         data.translateTo          ?? undefined,
        targetCategory:      data.targetCategory       ?? undefined,
        aiPrompt:            data.aiPrompt             ?? undefined,
        socialAccountId:     data.socialAccountId      ?? undefined,
        socialTemplate:      data.socialTemplate       ?? undefined,
        languageSiteMapping: data.languageSiteMapping  ?? undefined,
        categoryMappings:    data.categoryMappings     ?? undefined,
      },
    })
  })

  app.patch('/pipelines/:id', { onRequest: [app.authenticate] }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    const data = pipelineSchema.partial().parse(req.body)
    return db.pipeline.update({
      where: { id },
      data: {
        ...data,
        sourceFilter:        data.sourceFilter        === null ? undefined : data.sourceFilter,
        translateTo:         data.translateTo          ?? undefined,
        targetCategory:      data.targetCategory       ?? undefined,
        aiPrompt:            data.aiPrompt             ?? undefined,
        socialAccountId:     data.socialAccountId      ?? undefined,
        socialTemplate:      data.socialTemplate       ?? undefined,
        languageSiteMapping: data.languageSiteMapping  === null ? undefined : data.languageSiteMapping,
        categoryMappings:    data.categoryMappings     === null ? undefined : data.categoryMappings,
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

    // autoPublish only gates scheduled runs — manual trigger always works
    if (!pipeline.siteIds.length) return { queued: 0, reason: 'no sites configured' }

    const filter: Record<string, unknown> = { publishStatus: 'DRAFT' }
    if (pipeline.qualityMin > 0) filter['qualityScore'] = { gte: pipeline.qualityMin }

    const sourceFilter = pipeline.sourceFilter as string[] | null
    if (sourceFilter?.length) filter['sourceId'] = { in: sourceFilter }

    const categoryMappings = pipeline.categoryMappings as Array<{
      sourceId: string; sourceCategory: string; destCategoryId: number | null; destCategoryName: string | null
    }> | null

    if (categoryMappings?.length) {
      const mappedCategories = [...new Set(categoryMappings.map(m => m.sourceCategory))]
      filter['categories'] = { hasSome: mappedCategories }
    } else if (pipeline.categoryFilter?.length) {
      filter['categories'] = { hasSome: pipeline.categoryFilter }
    }

    const postLimit = (pipeline as any).postLimit ?? 50
    const posts = await db.aggregatedPost.findMany({
      where: filter as any,
      orderBy: { createdAt: 'desc' },
      take: postLimit,
      select: { id: true, language: true, categories: true, sourceId: true },
    })

    // Hoist social account lookup outside the loop
    const socialAccount = pipeline.socialAccountId
      ? await db.socialAccount.findUnique({ where: { id: pipeline.socialAccountId } })
      : null

    // Batch duplicate publish task check to avoid N+1
    const postIds = posts.map(p => p.id)
    const existingTasks = await db.publishTask.findMany({
      where: { postId: { in: postIds }, siteId: { in: pipeline.siteIds } },
      select: { postId: true, siteId: true },
    })
    const existingSet = new Set(existingTasks.map(t => `${t.postId}:${t.siteId}`))

    const languageSiteMapping = pipeline.languageSiteMapping as Record<string, string[]> | null
    const windowMs = pipeline.publishWindowHours > 0 ? pipeline.publishWindowHours * 60 * 60 * 1000 : 0
    const totalSlots = posts.length * pipeline.siteIds.length
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
        if (existingSet.has(`${post.id}:${siteId}`)) { taskIndex++; continue }

        let categoryOverride: string | null = pipeline.targetCategory ?? null
        if (categoryMappings?.length) {
          const postCategories = (post.categories as string[]) ?? []
          for (const pc of postCategories) {
            const match = categoryMappings.find(
              m => m.sourceId === post.sourceId && m.sourceCategory === pc
            )
            if (match) {
              categoryOverride = match.destCategoryName ?? match.destCategoryId?.toString() ?? pc
              break
            }
          }
        }

        const delay = windowMs > 0 ? Math.round((taskIndex / totalSlots) * windowMs) : 0
        const task = await db.publishTask.create({
          data: { postId: post.id, siteId, wpStatus: pipeline.defaultStatus, categoryOverride },
        })
        await publishQueue.add('publish-post', {
          publishTaskId: task.id,
          aiPrompt: pipeline.aiPrompt ?? undefined,
        }, delay ? { delay } : undefined)

        if (socialAccount && pipeline.socialTemplate) {
          const socialPost = await db.socialPost.create({
            data: {
              postId:    post.id,
              accountId: pipeline.socialAccountId!,
              platform:  socialAccount.platform,
              template:  pipeline.socialTemplate,
              status:    'PENDING',
            },
          })
          await socialQueue.add('post', { socialPostId: socialPost.id }, delay ? { delay: delay + 5000 } : undefined)
        }

        queued++
        taskIndex++
      }
    }

    return { queued }
  })
}
