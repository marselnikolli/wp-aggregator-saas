import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { fetch } from 'undici'
import { db } from '../db.js'
import { fetchQueue, fetchQueueEvents } from '../queue.js'
import { encrypt } from '../lib/crypto.js'

const INTERVAL_MS: Record<string, number> = {
  '15m': 900_000,
  '1h':  3_600_000,
  '6h':  21_600_000,
  '24h': 86_400_000,
}

export async function registerSourceSchedulers() {
  const sources = await db.source.findMany({
    where: { interval: { not: null } },
    select: { id: true, interval: true },
  })
  for (const src of sources) {
    const ms = INTERVAL_MS[src.interval!]
    if (!ms) continue
    await fetchQueue.upsertJobScheduler(
      `fetch-source-${src.id}`,
      { every: ms },
      { name: 'fetch-source', data: { sourceId: src.id } },
    )
  }
  if (sources.length) console.log(`[scheduler] Restored ${sources.length} source schedulers`)
}

const sourceBody = z.object({
  name:     z.string().min(1),
  endpoint: z.string().min(1),
  type:     z.enum(['RSS', 'WP_API', 'CUSTOM_API']).default('RSS'),
  enabled:  z.boolean().optional().default(true),
})

const sourceUpdateBody = z.object({
  name:              z.string().min(1).optional(),
  endpoint:          z.string().min(1).optional(),
  type:              z.enum(['RSS', 'WP_API', 'CUSTOM_API']).optional(),
  enabled:           z.boolean().optional(),
  interval:          z.enum(['15m', '1h', '6h', '24h']).nullable().optional(),
  username:          z.string().optional(),
  password:          z.string().optional(),
  fieldMap:          z.record(z.string()).nullable().optional(),
  categoryMappings:  z.array(z.object({ id: z.string(), name: z.string() })).nullable().optional(),
  paginationParam:   z.string().nullable().optional(),
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
    // Never send password to client
    const safeItems = items.map(({ password: _pw, ...s }) => s)
    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items: safeItems }
  })

  app.post('/sources', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = sourceBody.parse(req.body)
    const source = await db.source.create({ data: body })
    const { password: _pw, ...safe } = source
    return reply.code(201).send(safe)
  })

  app.patch('/sources/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const body = sourceUpdateBody.parse(req.body)

    const data: Record<string, any> = { ...body }

    // Encrypt password if provided
    if (body.password !== undefined) {
      data.password = body.password ? encrypt(body.password) : null
    }

    const source = await db.source.update({ where: { id }, data })

    // Sync BullMQ scheduler
    if ('interval' in body) {
      const schedulerId = `fetch-source-${id}`
      if (source.interval && INTERVAL_MS[source.interval]) {
        await fetchQueue.upsertJobScheduler(
          schedulerId,
          { every: INTERVAL_MS[source.interval] },
          { name: 'fetch-source', data: { sourceId: id } },
        )
      } else {
        await fetchQueue.removeJobScheduler(schedulerId).catch(() => { /* ok if not found */ })
      }
    }

    const { password: _pw, ...safe } = source
    return safe
  })

  app.delete('/sources/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await fetchQueue.removeJobScheduler(`fetch-source-${id}`).catch(() => { /* ok if not found */ })
    await db.source.delete({ where: { id } })
    return reply.code(204).send()
  })

  // Probe a URL and detect WP_API or RSS feed
  app.post('/sources/detect', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { url } = z.object({ url: z.string().min(1) }).parse(req.body)

    let base = url.trim()
    if (!/^https?:\/\//i.test(base)) base = 'https://' + base
    base = base.replace(/\/$/, '').replace(/\/wp-json.*$/, '')
    const name = new URL(base).hostname.replace(/^www\./, '')

    const probes: Array<{ path: string; type: 'WP_API' | 'RSS' }> = [
      { path: '/wp-json/wp/v2/posts?per_page=1&_fields=id', type: 'WP_API' },
      { path: '/feed',     type: 'RSS' },
      { path: '/rss',      type: 'RSS' },
      { path: '/feed.xml', type: 'RSS' },
      { path: '/atom.xml', type: 'RSS' },
      { path: '/rss.xml',  type: 'RSS' },
    ]

    const results = await Promise.allSettled(
      probes.map(async ({ path, type }) => {
        const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error('not ok')
        if (type === 'WP_API') {
          const data = await res.json()
          if (!Array.isArray(data) || !data[0]?.id) throw new Error('not wp')
          return { type, endpoint: `${base}/wp-json/wp/v2/posts`, name }
        }
        const ct = res.headers.get('content-type') ?? ''
        if (!ct.includes('xml') && !ct.includes('rss') && !ct.includes('atom')) throw new Error('not feed')
        return { type, endpoint: `${base}${path}`, name }
      })
    )

    const hit = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any> | undefined
    if (!hit) return reply.code(422).send({ error: 'No feed detected at this URL' })
    return hit.value
  })

  // Fetch category list directly from the WP site or from stored posts
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
      } catch { /* fall through */ }
    }

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
