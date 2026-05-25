import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { fetch } from 'undici'
import { db } from '../db.js'
import { fetchQueue, fetchQueueEvents } from '../queue.js'
import { encrypt } from '../lib/crypto.js'
import { unwrapResponse, CAT_NAME_KEYS, FIELD_GUESS_MAP, tryParseBody } from '../lib/customApi.js'
import { audit } from '../lib/audit.js'

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
  autoApprove:       z.boolean().optional(),
  tags:              z.array(z.string()).optional(),
  minDelaySec:       z.number().int().min(0).max(60).optional(),
  fieldMap:          z.record(z.string()).nullable().optional(),
  categoryMappings:  z.array(z.object({ id: z.string(), name: z.string() })).nullable().optional(),
  paginationParam:   z.string().nullable().optional(),
  userAgent:         z.string().nullable().optional(),
  proxyUrl:          z.string().nullable().optional(),
  categoryMap:       z.record(z.record(z.string())).nullable().optional(),
})

export async function sourcesRoutes(app: FastifyInstance) {
  app.get('/sources', { preHandler: [app.authenticate] }, async (req) => {
    const query = z.object({
      page:     z.coerce.number().min(1).default(1),
      per_page: z.coerce.number().min(1).max(100).default(20),
      tag:      z.string().optional(),
    }).parse(req.query)

    const where = query.tag ? { tags: { has: query.tag } } : undefined

    const [total, items] = await Promise.all([
      db.source.count({ where }),
      db.source.findMany({
        where,
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: { _count: { select: { posts: true } } },
      }),
    ])
    // Never send password to client
    const safeItems = items.map(({ password: _pw, ...s }) => s)
    return { total, pages: Math.ceil(total / query.per_page), page: query.page, items: safeItems }
  })

  app.post('/sources', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = sourceBody.parse(req.body)

    // Deduplication: warn if same hostname already exists
    let duplicateWarning: string | undefined
    try {
      const hostname = new URL(body.endpoint).hostname
      const existing = await db.source.findFirst({
        where: { endpoint: { contains: hostname } },
        select: { name: true },
      })
      if (existing) duplicateWarning = `Domain already used by "${existing.name}"`
    } catch { /* invalid URL — skip check */ }

    const source = await db.source.create({ data: body })
    const jwt = req.user as { sub: string; email?: string }
    audit('source.create', { userId: jwt.sub, userEmail: jwt.email, resourceType: 'source', resourceId: source.id, metadata: { name: source.name, type: source.type } })
    const { password: _pw, ...safe } = source
    return reply.code(201).send({ ...safe, ...(duplicateWarning ? { warning: duplicateWarning } : {}) })
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
    const jwt = req.user as { sub: string; email?: string }
    const source = await db.source.findUnique({ where: { id }, select: { name: true } })
    await fetchQueue.removeJobScheduler(`fetch-source-${id}`).catch(() => { /* ok if not found */ })
    await db.source.delete({ where: { id } })
    audit('source.delete', { userId: jwt.sub, userEmail: jwt.email, resourceType: 'source', resourceId: id, metadata: { name: source?.name } })
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

  // Reorder: set sortOrder for a source by providing before/after neighbour IDs
  app.patch('/sources/:id/reorder', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const { beforeId, afterId } = z.object({
      beforeId: z.string().nullable().optional(),
      afterId:  z.string().nullable().optional(),
    }).parse(req.body)

    const [before, after] = await Promise.all([
      beforeId ? db.source.findUnique({ where: { id: beforeId }, select: { sortOrder: true } }) : null,
      afterId  ? db.source.findUnique({ where: { id: afterId  }, select: { sortOrder: true } }) : null,
    ])

    const lo = before?.sortOrder ?? 0
    const hi = after?.sortOrder ?? lo + 2
    const newOrder = (lo + hi) / 2

    return db.source.update({ where: { id }, data: { sortOrder: newOrder }, select: { id: true, sortOrder: true } })
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

  app.post('/sources/scan-custom', { preHandler: [app.authenticate] }, async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().min(1) }).parse(req.body)

    const categories: Array<{ id: string; name: string; count: number }> = []
    let consecutiveMisses = 0
    let isHtml = false

    for (let batchStart = 1; batchStart <= 9999 && consecutiveMisses < 10; batchStart += 10) {
      const batchSize = Math.min(10, 10000 - batchStart)
      const batchIds = Array.from({ length: batchSize }, (_, i) => batchStart + i)

      const results = await Promise.allSettled(
        batchIds.map(async (id) => {
          const url = endpoint.replace('{id}', String(id))
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
          if (!res.ok) throw new Error('not ok')
          const text = await res.text()
          const parsed = tryParseBody(text)
          if (!parsed.items.length) throw new Error('empty')
          const first = parsed.items[0] as Record<string, unknown>
          isHtml = parsed.isHtml
          let name: string | undefined
          if (parsed.isHtml) {
            name = (first.category as string) || `Category ${id}`
          } else {
            for (const key of CAT_NAME_KEYS) {
              if (typeof first[key] === 'string' && first[key]) { name = first[key] as string; break }
            }
          }
          return { id: String(id), name: name ?? `Category ${id}`, count: parsed.items.length }
        })
      )

      for (const r of results) {
        if (r.status === 'fulfilled') {
          categories.push(r.value)
          consecutiveMisses = 0
        } else {
          consecutiveMisses++
        }
      }
    }

    let suggestedFieldMap: Record<string, string> = {}
    let sampleKeys: string[] = []

    if (categories.length) {
      try {
        const firstUrl = endpoint.replace('{id}', categories[0].id)
        const res = await fetch(firstUrl, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          const text = await res.text()
          const parsed = tryParseBody(text)
          if (parsed.items.length) {
            if (parsed.isHtml) {
              sampleKeys = Object.keys(parsed.items[0] as object)
              suggestedFieldMap = {
                title: 'title',
                imageUrl: 'image',
                originalUrl: 'url',
                remoteId: 'id',
              }
            } else {
              const data = JSON.parse(text)
              const items = unwrapResponse(data)
              if (items.length) {
                sampleKeys = Object.keys(items[0] as object)
                for (const [field, candidates] of Object.entries(FIELD_GUESS_MAP)) {
                  for (const c of candidates) {
                    if (sampleKeys.includes(c)) { suggestedFieldMap[field] = c; break }
                  }
                }
              }
            }
          }
        }
      } catch { /* non-fatal */ }
    }

    return { categories, suggestedFieldMap, sampleKeys }
  })

  app.get('/sources/:id/health', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }

    const jobs = await db.fetchJob.findMany({
      where:   { sourceId: id },
      orderBy: { createdAt: 'desc' },
      take:    50,
      select:  { id: true, status: true, fetched: true, newPosts: true, duration: true, error: true, createdAt: true },
    })

    const total   = jobs.length
    const success = jobs.filter(j => j.status === 'OK').length
    const durations = jobs.map(j => j.duration).filter((d): d is number => d !== null)
    const avgDuration = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null

    return {
      totalJobs:    total,
      successJobs:  success,
      successRate:  total ? Math.round((success / total) * 100) : null,
      avgDuration,
      recentJobs:   jobs.slice(0, 20),
    }
  })
}
