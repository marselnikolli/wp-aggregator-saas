import { Queue, Worker } from 'bullmq'
import { redisOpts } from '../queue.js'
import { db } from '../db.js'
import { encrypt, decrypt } from '../lib/crypto.js'

const FB_BASE    = 'https://graph.facebook.com'
const FB_VERSION = 'v25.0'

export const rotationQueue = new Queue('token-rotation', {
  connection: redisOpts,
  defaultJobOptions: { removeOnComplete: 50, removeOnFail: 100 },
})

async function rotateAccount(id: string): Promise<void> {
  const account = await db.socialAccount.findUnique({ where: { id } })
  if (!account?.appId || !account.appSecret || !account.longLivedUserToken) return

  const appSecret    = decrypt(account.appSecret)
  const currentToken = decrypt(account.longLivedUserToken)

  // Self-extend the long-lived user token (works up to ~60 days after last exchange)
  const exchangeUrl = new URL(`${FB_BASE}/${FB_VERSION}/oauth/access_token`)
  exchangeUrl.searchParams.set('grant_type', 'fb_exchange_token')
  exchangeUrl.searchParams.set('client_id', account.appId)
  exchangeUrl.searchParams.set('client_secret', appSecret)
  exchangeUrl.searchParams.set('fb_exchange_token', currentToken)

  const exchangeRes  = await fetch(exchangeUrl.toString())
  const exchangeJson = await exchangeRes.json() as { access_token?: string; error?: { message: string } }

  if (!exchangeRes.ok || !exchangeJson.access_token) {
    throw new Error(`Token rotation failed for account ${id}: ${exchangeJson.error?.message ?? 'unknown error'}`)
  }
  const newUserToken = exchangeJson.access_token

  // For Facebook accounts, get a fresh page token too
  let newPageToken: string | null = null
  if (account.platform === 'FACEBOOK') {
    const ptRes  = await fetch(`${FB_BASE}/${FB_VERSION}/${account.pageId}?fields=access_token&access_token=${newUserToken}`)
    const ptJson = await ptRes.json() as { access_token?: string }
    newPageToken = ptJson.access_token ?? null
  }

  const now             = new Date()
  const encNewUserToken = encrypt(newUserToken)
  const encNewPageToken = newPageToken ? encrypt(newPageToken) : null

  await db.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {
      longLivedUserToken: encNewUserToken,
      lastRotation:       now,
    }
    if (encNewPageToken) updateData.accessToken = encNewPageToken

    await tx.socialAccount.update({ where: { id }, data: updateData, select: { id: true } })

    // Propagate to linked Instagram accounts
    if (encNewPageToken) {
      await tx.socialAccount.updateMany({
        where: { linkedAccountId: id },
        data: { accessToken: encNewPageToken, longLivedUserToken: encNewUserToken, lastRotation: now },
      })
    }
  })

  console.log(`[token-rotation] Rotated account ${account.name} (${account.platform})`)
}

export function startTokenRotationWorker() {
  const worker = new Worker(
    'token-rotation',
    async (job) => {
      if (job.name === 'rotate-account') {
        await rotateAccount(job.data.accountId as string)
      } else if (job.name === 'check-all') {
        // Find all root accounts (no linkedAccountId) due for rotation
        const accounts = await db.socialAccount.findMany({
          where: {
            appId:              { not: null },
            appSecret:          { not: null },
            longLivedUserToken: { not: null },
            linkedAccountId:    null,
            OR: [
              { lastRotation: null },
              {
                lastRotation: {
                  lt: new Date(Date.now() - 1000 * 60 * 60 * 24), // at least 1 day old (actual threshold checked below)
                },
              },
            ],
          },
          select: { id: true, lastRotation: true, rotationDays: true, name: true },
        })

        for (const account of accounts) {
          const daysElapsed = account.lastRotation
            ? (Date.now() - account.lastRotation.getTime()) / (1000 * 60 * 60 * 24)
            : Infinity
          if (daysElapsed >= account.rotationDays) {
            await rotationQueue.add('rotate-account', { accountId: account.id }, {
              jobId: `rotate-${account.id}-${Date.now()}`,
            })
          }
        }
      }
    },
    { connection: redisOpts, concurrency: 2 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[token-rotation] Job ${job?.id} failed:`, err.message)
  })

  return worker
}

export async function scheduleRotationCheck() {
  await rotationQueue.upsertJobScheduler(
    'rotation-daily-check',
    { pattern: '0 3 * * *' }, // 3am every day
    { name: 'check-all', data: {} },
  )
}
