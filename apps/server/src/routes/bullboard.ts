import { FastifyInstance } from 'fastify'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createBullBoard } = require('@bull-board/api')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FastifyAdapter } = require('@bull-board/fastify')
import { Queue } from 'bullmq'
import { redis } from '../queue.js'
import { summarizeQueue } from '../workers/summarizer.js'

export async function bullboardRoutes(app: FastifyInstance) {
  const fetchQueue    = new Queue('fetch',   { connection: redis })
  const publishQueue  = new Queue('publish', { connection: redis })

  const serverAdapter = new FastifyAdapter()
  serverAdapter.setBasePath('/admin/queues')

  createBullBoard({
    queues: [
      new BullMQAdapter(fetchQueue),
      new BullMQAdapter(publishQueue),
      new BullMQAdapter(summarizeQueue),
    ],
    serverAdapter,
  })

  await app.register(serverAdapter.registerPlugin(), { prefix: '/admin/queues', basePath: '/admin/queues' })
}
