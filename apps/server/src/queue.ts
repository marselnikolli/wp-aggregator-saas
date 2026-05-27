import { Queue, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'
import { config } from './config.js'

// BullMQ v5 requires raw RedisOptions, not an IORedis instance
const url = new URL(config.REDIS_URL)
export const redisOpts = {
  host:     url.hostname,
  port:     Number(url.port) || 6379,
  password: url.password || undefined,
  maxRetriesPerRequest: null as unknown as undefined, // required by BullMQ
}

// IORedis instance for direct operations (caching, pubsub, etc.)
export const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })

export const fetchQueue = new Queue('fetch', {
  connection: redisOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})

export const publishQueue = new Queue('publish', {
  connection: redisOpts,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})

export const fetchQueueEvents  = new QueueEvents('fetch',   { connection: redisOpts })
export const publishQueueEvents = new QueueEvents('publish', { connection: redisOpts })
