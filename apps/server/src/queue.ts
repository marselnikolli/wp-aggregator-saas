import { Queue, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'
import { config } from './config.js'

export const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })

export const fetchQueue = new Queue('fetch', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})

export const publishQueue = new Queue('publish', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})

export const fetchQueueEvents = new QueueEvents('fetch', { connection: redis })
export const publishQueueEvents = new QueueEvents('publish', { connection: redis })
