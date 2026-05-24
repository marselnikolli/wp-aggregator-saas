import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { fetch } from 'undici'
import { db } from '../db.js'
import { fetchQueue, fetchQueueEvents } from '../queue.js'

const sourceBody = z.object({
  name:     z.string().min(1),
  endpoint: z.string().url(),
  type:     z.enum(['RSS', 'WP_API']).default('RSS'),
  enabled:  z.boolean().optional().default(true),
})

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/sources', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({
      page:     z.coerce.number().min(1).default(1),
      per_page: z.coerce.number().min(1).max(100).default(20),
    }).parse(req.query)

    const [total, items] = await Promise.all([
      db.source.count(),
      db.source.findMany({
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { posts: true } } },
      }),
    ])
    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items }
  })

  app.post('/sources', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = sourceBody.parse(req.body)
    const source = await db.source.create({ data: body })
    return reply.code(201).send(source)
  })

  app.patch('/sources/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const body = sourceBody.partial().parse(req.body)
    return db.source.update({ where: { id }, data: body })
  })

  app.delete('/sources/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.source.delete({ where: { id } })
    return reply.code(204).send()
  })

  // Fetch category list directly from the WP site (WP_API sources) or from stored posts (RSS)
  app.get('/sources/:id/categories', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const source = await db.source.findUniqueOrThrow({ where: { id } })

    if (source.type === 'WP_API') {
      try {
        const base = source.endpoint.replace('/wp-json/wp/v2/posts', '').replace(/\/$/, '')
        const res = await fetch(
          `${base}/wp-json/wp/v2/categories?per_page=100&_fields=id,name`,
          { signal: AbortSignal.timeout(10000) },
        )
        if (res.ok) {
          const cats = await res.json() as Array<{ id: number; name: string }>
          return cats.map(c => c.name).sort()
        }
      } catch { /* fall through to stored categories */ }
    }

    // RSS or WP fallback: return distinct categories from stored posts
    const posts = await db.aggregatedPost.findMany({
      select: { categories: true },
      where: { sourceId: id },
    })
    return [...new Set(posts.flatMap(p => p.categories))].filter(Boolean).sort()
  })

  app.post('/sources/:id/fetch', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    await db.source.findUniqueOrThrow({ where: { id } })
    const job = await fetchQueue.add('fetch-source', { sourceId: id }, { priority: 1 })
    return { jobId: job.id }
  })

  app.post('/sources/fetch-all', { preHandler: [app.authenticate] }, async () => {
    const sources = await db.source.findMany({ where: { enabled: true }, select: { id: true } })
    const jobs = await Promise.all(
      sources.map((s) => fetchQueue.add('fetch-source', { sourceId: s.id }))
    )
    return { queued: jobs.length }
  })

  app.get('/sources/events', { preHandler: [app.authenticate] }, async (req, reply) => {
    const res = reply.raw
    res.writeHead(200, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()

    const send = (data: object) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    async function onActive({ jobId }: { jobId: string }) {
      const job = await fetchQueue.getJob(jobId)
      if (job?.data?.sourceId) send({ type: 'job:active', sourceId: job.data.sourceId, jobId })
    }
    async function onCompleted({ jobId }: { jobId: string }) {
      const job = await fetchQueue.getJob(jobId)
      if (job?.data?.sourceId) send({ type: 'job:completed', sourceId: job.data.sourceId })
    }
    async function onFailed({ jobId, failedReason }: { jobId: string; failedReason: string }) {
      const job = await fetchQueue.getJob(jobId)
      if (job?.data?.sourceId) send({ type: 'job:failed', sourceId: job.data.sourceId, error: failedReason })
    }

    fetchQueueEvents.on('active',    onActive)
    fetchQueueEvents.on('completed', onCompleted)
    fetchQueueEvents.on('failed',    onFailed)

    const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n') }, 30_000)

    await new Promise<void>(resolve =>
      req.raw.once('close', () => {
        clearInterval(keepAlive)
        fetchQueueEvents.off('active',    onActive)
        fetchQueueEvents.off('completed', onCompleted)
        fetchQueueEvents.off('failed',    onFailed)
        resolve()
      })
    )
  })

  app.post('/sources/import', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      urls: z.array(z.string().min(1)).min(1).max(500),
    }).parse(req.body)

    const results: Array<{ url: string; status: 'created' | 'duplicate' | 'error'; name?: string; error?: string }> = []

    for (const rawUrl of body.urls) {
      try {
        // Normalize: add protocol if missing, strip any wp-json path suffix
        let normalized = rawUrl.trim()
        if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized
        const wpJsonIdx = normalized.indexOf('/wp-json')
        if (wpJsonIdx !== -1) normalized = normalized.slice(0, wpJsonIdx)
        const base = normalized.replace(/\/$/, '')
        const endpoint = `${base}/wp-json/wp/v2/posts`
        const name = new URL(base).hostname.replace(/^www\./, '')

        const existing = await db.source.findFirst({ where: { endpoint } })
        if (existing) {
          results.push({ url: rawUrl, status: 'duplicate', name: existing.name })
          continue
        }

        await db.source.create({ data: { name, endpoint, type: 'WP_API', enabled: true } })
        results.push({ url: rawUrl, status: 'created', name })
      } catch (err) {
        results.push({ url: rawUrl, status: 'error', error: err instanceof Error ? err.message : 'Invalid URL' })
      }
    }

    const created    = results.filter(r => r.status === 'created').length
    const duplicates = results.filter(r => r.status === 'duplicate').length
    const errors     = results.filter(r => r.status === 'error').length

    return reply.code(201).send({ created, duplicates, errors, results })
  })
}
