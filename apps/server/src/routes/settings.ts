import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { fetch } from 'undici'
import { db } from '../db.js'
import { encrypt, decrypt } from '../lib/crypto.js'
import { applyScheduledPublishSettings } from '../workers/schedPublisher.js'

const ENCRYPTED = new Set(['openai_key', 'anthropic_key'])

async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } })
  if (!row) return null
  return ENCRYPTED.has(key) ? decrypt(row.value) : row.value
}

async function setSetting(key: string, value: string) {
  const stored = ENCRYPTED.has(key) ? encrypt(value) : value
  await db.setting.upsert({
    where:  { key },
    create: { key, value: stored },
    update: { value: stored },
  })
}

export async function getSettingValue(key: string): Promise<string | null> {
  return getSetting(key)
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/settings', { onRequest: [app.authenticate] }, async () => {
    const [openai, anthropic, interval, threshold] = await Promise.all([
      db.setting.findUnique({ where: { key: 'openai_key' } }),
      db.setting.findUnique({ where: { key: 'anthropic_key' } }),
      db.setting.findUnique({ where: { key: 'fetch_interval' } }),
      db.setting.findUnique({ where: { key: 'quality_threshold' } }),
    ])
    return {
      openaiKeySet:     !!openai,
      anthropicKeySet:  !!anthropic,
      fetchInterval:    interval  ? Number(interval.value)  : 60,
      qualityThreshold: threshold ? Number(threshold.value) : 0,
    }
  })

  app.post('/settings/ai-keys', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { openaiKey, anthropicKey } = z.object({
      openaiKey:    z.string().optional(),
      anthropicKey: z.string().optional(),
    }).parse(req.body)
    if (openaiKey    !== undefined) await setSetting('openai_key',    openaiKey)
    if (anthropicKey !== undefined) await setSetting('anthropic_key', anthropicKey)
    reply.code(204).send()
  })

  app.post('/settings/schedule', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { fetchInterval } = z.object({
      fetchInterval: z.number().int().min(5).max(1440),
    }).parse(req.body)
    await setSetting('fetch_interval', String(fetchInterval))
    reply.code(204).send()
  })

  app.post('/settings/quality-threshold', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { threshold } = z.object({ threshold: z.number().int().min(0).max(100) }).parse(req.body)
    await setSetting('quality_threshold', String(threshold))
    reply.code(204).send()
  })

  app.post('/settings/test-ai', { onRequest: [app.authenticate] }, async (req) => {
    const { provider } = z.object({ provider: z.enum(['openai', 'anthropic']) }).parse(req.body)
    const key = await getSetting(provider === 'openai' ? 'openai_key' : 'anthropic_key')
    if (!key) return { ok: false, error: 'No key configured' }

    try {
      if (provider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        })
        return { ok: res.ok, error: res.ok ? null : `HTTP ${res.status}` }
      } else {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(8000),
        })
        return { ok: res.ok, error: res.ok ? null : `HTTP ${res.status}` }
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  app.get('/settings/blocklist', { onRequest: [app.authenticate] }, async () => {
    const row = await db.setting.findUnique({ where: { key: 'blocklist' } })
    const words: string[] = row ? JSON.parse(row.value) : []
    return { words }
  })

  app.post('/settings/blocklist', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { words } = z.object({ words: z.array(z.string()) }).parse(req.body)
    await setSetting('blocklist', JSON.stringify(words.map(w => w.trim().toLowerCase()).filter(Boolean)))
    reply.code(204).send()
  })

  app.delete('/settings/ai-keys/:provider', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { provider } = z.object({ provider: z.enum(['openai', 'anthropic']) }).parse(req.params)
    const key = provider === 'openai' ? 'openai_key' : 'anthropic_key'
    await db.setting.deleteMany({ where: { key } })
    reply.code(204).send()
  })

  app.get('/settings/webhook', { onRequest: [app.authenticate] }, async () => {
    const row = await db.setting.findUnique({ where: { key: 'webhook_url' } })
    return { url: row?.value ?? '' }
  })

  app.post('/settings/webhook', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { url } = z.object({ url: z.string() }).parse(req.body)
    if (url) {
      await setSetting('webhook_url', url)
    } else {
      await db.setting.deleteMany({ where: { key: 'webhook_url' } })
    }
    reply.code(204).send()
  })

  app.post('/settings/import', { onRequest: [app.authenticate] }, async (req, reply) => {
    const body = z.object({
      version:  z.number(),
      sources:  z.array(z.any()).optional().default([]),
      settings: z.array(z.object({ key: z.string(), value: z.string() })).optional().default([]),
    }).parse(req.body)

    const SKIP_KEYS = new Set(['openai_key', 'anthropic_key'])
    let sourcesRestored = 0
    let settingsRestored = 0

    for (const src of body.sources) {
      try {
        await db.source.upsert({
          where: { id: src.id },
          create: { ...src, createdAt: undefined, updatedAt: undefined },
          update: { ...src, id: undefined, createdAt: undefined, updatedAt: undefined },
        })
        sourcesRestored++
      } catch { /* skip individual failures */ }
    }

    for (const s of body.settings) {
      if (SKIP_KEYS.has(s.key)) continue
      await db.setting.upsert({ where: { key: s.key }, create: s, update: { value: s.value } })
      settingsRestored++
    }

    return { sourcesRestored, settingsRestored }
  })

  app.get('/settings/ip-allowlist', { onRequest: [app.authenticate] }, async () => {
    const row = await db.setting.findUnique({ where: { key: 'ip_allowlist' } })
    const ips: string[] = row ? JSON.parse(row.value) : []
    return { ips }
  })

  app.post('/settings/ip-allowlist', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { ips } = z.object({ ips: z.array(z.string()) }).parse(req.body)
    await setSetting('ip_allowlist', JSON.stringify(ips))
    reply.code(204).send()
  })

  app.get('/settings/scheduled-publish', { onRequest: [app.authenticate] }, async () => {
    const [enabledRow, timeRow, siteIdsRow, maxRow, rrRow] = await Promise.all([
      db.setting.findUnique({ where: { key: 'sched_publish_enabled' } }),
      db.setting.findUnique({ where: { key: 'sched_publish_time' } }),
      db.setting.findUnique({ where: { key: 'sched_publish_site_ids' } }),
      db.setting.findUnique({ where: { key: 'sched_publish_max' } }),
      db.setting.findUnique({ where: { key: 'sched_publish_round_robin' } }),
    ])
    return {
      enabled:    enabledRow?.value === 'true',
      time:       timeRow?.value ?? '08:00',
      siteIds:    siteIdsRow ? JSON.parse(siteIdsRow.value) : [],
      maxPerRun:  maxRow ? parseInt(maxRow.value) : 10,
      roundRobin: rrRow?.value === 'true',
    }
  })

  app.post('/settings/scheduled-publish', { onRequest: [app.authenticate] }, async (req) => {
    const body = z.object({
      enabled:    z.boolean(),
      time:       z.string().regex(/^\d{1,2}:\d{2}$/),
      siteIds:    z.array(z.string()),
      maxPerRun:  z.number().int().min(1).max(200).default(10),
      roundRobin: z.boolean().default(false),
    }).parse(req.body)

    await Promise.all([
      setSetting('sched_publish_enabled',    String(body.enabled)),
      setSetting('sched_publish_time',        body.time),
      setSetting('sched_publish_site_ids',    JSON.stringify(body.siteIds)),
      setSetting('sched_publish_max',         String(body.maxPerRun)),
      setSetting('sched_publish_round_robin', String(body.roundRobin)),
    ])

    await applyScheduledPublishSettings()
    return { ok: true }
  })

  app.get('/settings/export', { onRequest: [app.authenticate] }, async (_req, reply) => {
    const [sites, sources, posts, settings] = await Promise.all([
      db.site.findMany({ select: { id: true, name: true, url: true, apiUser: true, defaultCategory: true, defaultAuthorId: true, enabled: true } }),
      db.source.findMany(),
      db.aggregatedPost.findMany({ orderBy: { createdAt: 'desc' } }),
      db.setting.findMany({ where: { key: { not: { in: ['openai_key', 'anthropic_key'] } } } }),
    ])

    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      sites,
      sources,
      posts,
      settings,
    }

    reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="wp-aggregator-export-${new Date().toISOString().slice(0,10)}.json"`)
      .send(JSON.stringify(payload, null, 2))
  })
}
