import { Queue, Worker } from 'bullmq'
import { redis } from '../queue.js'
import { db } from '../db.js'
import { publishQueue } from '../queue.js'

export const schedPublishQueue = new Queue('sched-publish', { connection: redis })

export async function applyScheduledPublishSettings() {
  await schedPublishQueue.removeJobScheduler('sched-publish').catch(() => {})

  const [enabledRow, timeRow] = await Promise.all([
    db.setting.findUnique({ where: { key: 'sched_publish_enabled' } }),
    db.setting.findUnique({ where: { key: 'sched_publish_time' } }),
  ])

  if (enabledRow?.value !== 'true') return

  const [h, m] = (timeRow?.value ?? '08:00').split(':')
  const cron = `${Number(m)} ${Number(h)} * * *`

  await schedPublishQueue.upsertJobScheduler(
    'sched-publish',
    { pattern: cron },
    { name: 'sched-publish', data: {} },
  )
  console.log(`[sched-publish] scheduled at ${timeRow?.value ?? '08:00'} (cron: ${cron})`)
}

export function startSchedPublishWorker() {
  const worker = new Worker('sched-publish', async () => {
    const [siteIdsRow, maxRow, rrRow] = await Promise.all([
      db.setting.findUnique({ where: { key: 'sched_publish_site_ids' } }),
      db.setting.findUnique({ where: { key: 'sched_publish_max' } }),
      db.setting.findUnique({ where: { key: 'sched_publish_round_robin' } }),
    ])

    const siteIds: string[] = siteIdsRow ? JSON.parse(siteIdsRow.value) : []
    const max = maxRow ? parseInt(maxRow.value) : 10
    const roundRobin = rrRow?.value === 'true'

    if (!siteIds.length) return { published: 0 }

    const posts = await db.aggregatedPost.findMany({
      where: { publishStatus: 'DRAFT' },
      take: max,
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })

    let published = 0
    for (let i = 0; i < posts.length; i++) {
      // Round-robin: each post goes to one site cycling through the list
      // Normal: each post goes to ALL configured sites
      const targets = roundRobin ? [siteIds[i % siteIds.length]] : siteIds

      for (const siteId of targets) {
        const task = await db.publishTask.upsert({
          where: { postId_siteId: { postId: posts[i].id, siteId } },
          create: { postId: posts[i].id, siteId, status: 'PENDING', wpStatus: 'publish' },
          update: { status: 'PENDING', error: null, wpStatus: 'publish' },
        })
        await publishQueue.add('publish-post', { publishTaskId: task.id })
        published++
      }
    }

    console.log(`[sched-publish] queued ${published} publish tasks (${posts.length} posts, ${roundRobin ? 'round-robin' : 'all-sites'})`)
    return { published }
  }, { connection: redis })

  worker.on('failed', (job, err) => {
    console.error(`[sched-publish] job ${job?.id} failed:`, err.message)
  })

  return worker
}
