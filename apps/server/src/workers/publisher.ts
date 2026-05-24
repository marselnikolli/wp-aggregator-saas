import { Worker, Job } from 'bullmq'
import { redis } from '../queue.js'
import { db } from '../db.js'
import { WPClient } from '../lib/wp-client.js'
import { decrypt } from '../lib/crypto.js'

export interface PublishJobData {
  publishTaskId: string
}

async function runPublishTask(taskId: string) {
  const task = await db.publishTask.findUniqueOrThrow({
    where: { id: taskId },
    include: { post: true, site: true },
  })

  await db.publishTask.update({
    where: { id: taskId },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  })

  const client = new WPClient(
    task.site.url,
    task.site.apiUser,
    decrypt(task.site.apiPassword),
  )

  const { id: wpPostId } = await client.createPost({
    title:   task.post.title,
    content: task.post.aiSummary ?? task.post.content ?? '',
    excerpt: task.post.excerpt ?? undefined,
    status:  'publish',
  })

  await db.publishTask.update({
    where: { id: taskId },
    data: { status: 'DONE', wpPostId },
  })

  await db.site.update({
    where: { id: task.site.id },
    data: { lastPublished: new Date() },
  })

  if (task.post.publishStatus !== 'PUBLISHED') {
    await db.aggregatedPost.update({
      where: { id: task.post.id },
      data: { publishStatus: 'PUBLISHED', publishedDate: new Date() },
    })
  }
}

export function startPublishWorker() {
  const worker = new Worker<PublishJobData>(
    'publish',
    async (job: Job<PublishJobData>) => {
      try {
        await runPublishTask(job.data.publishTaskId)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        await db.publishTask.update({
          where: { id: job.data.publishTaskId },
          data: { status: 'FAILED', error },
        })
        throw err
      }
    },
    { connection: redis, concurrency: 2 },
  )

  worker.on('failed', (job, err) => {
    console.error(`[publish-worker] job ${job?.id} failed:`, err.message)
  })

  return worker
}
