import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db.js'
import { encrypt, decrypt } from '../lib/crypto.js'

const FB_BASE = 'https://graph.facebook.com'
const FB_VERSION = 'v25.0'

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  platform: true,
  pageId: true,
  siteId: true,
  enabled: true,
  appId: true,
  lastRotation: true,
  rotationDays: true,
  linkedAccountId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { socialPosts: true } },
} as const

const discoverBody = z.object({
  appId:           z.string().min(1),
  appSecret:       z.string().min(1),
  shortLivedToken: z.string().min(1),
})

const batchCreateBody = z.object({
  appId:              z.string().min(1),
  appSecret:          z.string().min(1),
  longLivedUserToken: z.string().min(1),
  page: z.object({
    id:        z.string(),
    name:      z.string(),
    pageToken: z.string(),
  }),
  instagram: z.object({ id: z.string(), username: z.string() }).nullable(),
  name:            z.string().min(1),
  rotationDays:    z.number().int().min(10).max(60).default(50),
  siteId:          z.string().optional().nullable(),
  enabled:         z.boolean().default(true),
  createFacebook:  z.boolean(),
  createInstagram: z.boolean(),
})

const updateBody = z.object({
  name:         z.string().min(1).optional(),
  siteId:       z.string().optional().nullable(),
  enabled:      z.boolean().optional(),
  rotationDays: z.number().int().min(10).max(60).optional(),
})

export async function socialAccountsRoutes(app: FastifyInstance) {
  app.get('/social-accounts', { preHandler: [app.authenticate] }, async () => {
    return db.socialAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select: ACCOUNT_SELECT,
    })
  })

  // Exchange short-lived token → long-lived user token, return pages + Instagram IDs
  app.post('/social-accounts/discover', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { appId, appSecret, shortLivedToken } = discoverBody.parse(req.body)

    const exchangeUrl = new URL(`${FB_BASE}/${FB_VERSION}/oauth/access_token`)
    exchangeUrl.searchParams.set('grant_type', 'fb_exchange_token')
    exchangeUrl.searchParams.set('client_id', appId)
    exchangeUrl.searchParams.set('client_secret', appSecret)
    exchangeUrl.searchParams.set('fb_exchange_token', shortLivedToken)

    const exchangeRes = await fetch(exchangeUrl.toString())
    const exchangeJson = await exchangeRes.json() as { access_token?: string; error?: { message: string } }

    if (!exchangeRes.ok || !exchangeJson.access_token) {
      return reply.code(400).send({
        error: exchangeJson.error?.message ?? 'Failed to exchange token. Check your App ID, App Secret, and token.',
      })
    }
    const userToken = exchangeJson.access_token

    const pagesRes = await fetch(`${FB_BASE}/${FB_VERSION}/me/accounts?fields=id,name,access_token&access_token=${userToken}`)
    const pagesJson = await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string }>; error?: { message: string } }

    if (!pagesRes.ok || !pagesJson.data) {
      return reply.code(400).send({
        error: pagesJson.error?.message ?? 'Failed to fetch pages. Ensure the token has pages_manage_posts and pages_read_engagement permissions.',
      })
    }
    if (pagesJson.data.length === 0) {
      return reply.code(400).send({ error: 'No Facebook Pages found. Make sure your account manages at least one Page.' })
    }

    const pages = await Promise.all(pagesJson.data.map(async (page) => {
      const igRes = await fetch(
        `${FB_BASE}/${FB_VERSION}/${page.id}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`,
      )
      const igJson = await igRes.json() as { instagram_business_account?: { id: string; username: string } }
      return {
        id:        page.id,
        name:      page.name,
        pageToken: page.access_token,
        instagram: igJson.instagram_business_account ?? null,
      }
    }))

    return { userToken, pages }
  })

  // Create FB and/or IG accounts atomically from a wizard setup
  app.post('/social-accounts/batch', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = batchCreateBody.parse(req.body)

    if (!body.createFacebook && !body.createInstagram) {
      return reply.code(400).send({ error: 'Select at least one account to create.' })
    }
    if (body.createInstagram && !body.instagram) {
      return reply.code(400).send({ error: 'No Instagram account found for this page.' })
    }

    const encAppSecret   = encrypt(body.appSecret)
    const encUserToken   = encrypt(body.longLivedUserToken)
    const encPageToken   = encrypt(body.page.pageToken)
    const now            = new Date()

    const accounts = await db.$transaction(async (tx) => {
      const created: any[] = []
      let fbId: string | null = null

      if (body.createFacebook) {
        const fb = await tx.socialAccount.create({
          data: {
            name:               body.name,
            platform:           'FACEBOOK',
            pageId:             body.page.id,
            accessToken:        encPageToken,
            appId:              body.appId,
            appSecret:          encAppSecret,
            longLivedUserToken: encUserToken,
            lastRotation:       now,
            rotationDays:       body.rotationDays,
            siteId:             body.siteId ?? null,
            enabled:            body.enabled,
          },
          select: ACCOUNT_SELECT,
        })
        fbId = fb.id
        created.push(fb)
      }

      if (body.createInstagram && body.instagram) {
        const ig = await tx.socialAccount.create({
          data: {
            name:               `${body.name} (Instagram)`,
            platform:           'INSTAGRAM',
            pageId:             body.instagram.id,
            accessToken:        encPageToken,
            appId:              body.appId,
            appSecret:          encAppSecret,
            longLivedUserToken: encUserToken,
            lastRotation:       now,
            rotationDays:       body.rotationDays,
            linkedAccountId:    fbId,
            siteId:             body.siteId ?? null,
            enabled:            body.enabled,
          },
          select: ACCOUNT_SELECT,
        })
        created.push(ig)
      }

      return created
    })

    return reply.code(201).send(accounts)
  })

  app.patch('/social-accounts/:id', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const body = updateBody.parse(req.body)
    return db.socialAccount.update({
      where: { id },
      data: body,
      select: ACCOUNT_SELECT,
    })
  })

  app.delete('/social-accounts/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.socialAccount.delete({ where: { id } })
    return reply.code(204).send()
  })

  app.post('/social-accounts/:id/test', { preHandler: [app.authenticate] }, async (req) => {
    const { id } = req.params as { id: string }
    const account = await db.socialAccount.findUniqueOrThrow({ where: { id } })
    const token = decrypt(account.accessToken)
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${token}`)
      const json = (await res.json()) as { id?: string; name?: string; error?: { message?: string } }
      if (!res.ok) return { ok: false, error: json.error?.message ?? 'Unknown error' }
      return { ok: true, name: json.name, id: json.id }
    } catch {
      return { ok: false, error: 'Network error' }
    }
  })

  // Manually trigger token rotation (or run on schedule)
  app.post('/social-accounts/:id/rotate', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const account = await db.socialAccount.findUniqueOrThrow({ where: { id } })

    if (!account.appId || !account.appSecret || !account.longLivedUserToken) {
      return reply.code(400).send({ error: 'Account has no rotation credentials stored.' })
    }

    const appId          = account.appId
    const appSecret      = decrypt(account.appSecret)
    const currentToken   = decrypt(account.longLivedUserToken)

    const exchangeUrl = new URL(`${FB_BASE}/${FB_VERSION}/oauth/access_token`)
    exchangeUrl.searchParams.set('grant_type', 'fb_exchange_token')
    exchangeUrl.searchParams.set('client_id', appId)
    exchangeUrl.searchParams.set('client_secret', appSecret)
    exchangeUrl.searchParams.set('fb_exchange_token', currentToken)

    const exchangeRes = await fetch(exchangeUrl.toString())
    const exchangeJson = await exchangeRes.json() as { access_token?: string; error?: { message: string } }

    if (!exchangeRes.ok || !exchangeJson.access_token) {
      return reply.code(400).send({ error: exchangeJson.error?.message ?? 'Failed to extend token.' })
    }
    const newUserToken = exchangeJson.access_token

    // Get fresh page token for Facebook accounts
    let newPageToken: string | null = null
    if (account.platform === 'FACEBOOK') {
      const ptRes  = await fetch(`${FB_BASE}/${FB_VERSION}/${account.pageId}?fields=access_token&access_token=${newUserToken}`)
      const ptJson = await ptRes.json() as { access_token?: string }
      newPageToken = ptJson.access_token ?? null
    }

    const now              = new Date()
    const encNewUserToken  = encrypt(newUserToken)
    const encNewPageToken  = newPageToken ? encrypt(newPageToken) : null

    await db.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        longLivedUserToken: encNewUserToken,
        lastRotation:       now,
      }
      if (encNewPageToken) updateData.accessToken = encNewPageToken

      await tx.socialAccount.update({ where: { id }, data: updateData, select: { id: true } })

      // Propagate new page token to linked accounts (Instagram linked to this FB account)
      if (encNewPageToken) {
        await tx.socialAccount.updateMany({
          where: { linkedAccountId: id },
          data: { accessToken: encNewPageToken, longLivedUserToken: encNewUserToken, lastRotation: now },
        })
      }
    })

    return { ok: true, rotatedAt: now.toISOString() }
  })
}
