import { Queue, Worker, Job } from 'bullmq'
import { redisOpts } from '../queue.js'
import { db } from '../db.js'
import { decrypt } from '../lib/crypto.js'
import { generateCaption } from '../lib/caption.js'
import { generateSocialImage, uploadSocialImage } from '../lib/social-image.js'

export interface SocialJobData {
  socialPostId: string
}

export const socialQueue = new Queue<SocialJobData, any, string>('social', {
  connection: redisOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})

async function processSocialPost(socialPostId: string): Promise<void> {
  const record = await db.socialPost.findUniqueOrThrow({
    where: { id: socialPostId },
    include: { post: true, account: true },
  })

  await db.socialPost.update({
    where: { id: socialPostId },
    data: { status: 'PROCESSING' },
  })

  try {
    const token = decrypt(record.account.accessToken)
    const pageId = record.account.pageId

    const captionTemplate = await db.captionTemplate.findFirst({
      where: { platform: record.account.platform },
    })

    const caption = generateCaption({
      title:           record.post.aiTitle ?? record.post.title,
      categories:      record.post.categories,
      aiTags:          record.post.aiTags,
      originalUrl:     record.post.originalUrl ?? '',
      wpUrl:           undefined,
      language:        captionTemplate?.language ?? 'sq',
      includeHashtags: captionTemplate?.includeHashtags ?? true,
      includeExcerpt:  captionTemplate?.includeExcerpt ?? false,
      excerpt:         record.post.excerpt ?? undefined,
      brandingText:    captionTemplate?.brandingText ?? undefined,
      emojiStyle:      (captionTemplate?.emojiStyle as 'category' | 'none') ?? 'category',
    })

    const link = record.post.originalUrl ?? ''
    const template = record.template

    let platformPostId: string | undefined

    if (template === 'link_post') {
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: caption, link, access_token: token }),
      })
      const data = await res.json() as any
      if (data.error) throw new Error(data.error.message ?? 'Facebook API error')
      platformPostId = data.id

    } else if (template === 'photo_only') {
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: record.post.imageUrl, caption: record.post.title, access_token: token }),
      })
      const data = await res.json() as any
      if (data.error) throw new Error(data.error.message ?? 'Facebook API error')
      platformPostId = data.id

    } else if (template === 'image_overlay') {
      const imgBuffer = await generateSocialImage({
        title:          record.post.title,
        categories:     record.post.categories,
        imageUrl:       record.post.imageUrl ?? undefined,
        categoryColors: captionTemplate ? (captionTemplate.categoryColors as Record<string, string> ?? {}) : {},
      })
      const imgUrl = await uploadSocialImage(imgBuffer, record.post.id)
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imgUrl, caption: record.post.title, access_token: token }),
      })
      const json = await res.json() as any
      if (json.error) throw new Error(json.error.message)
      platformPostId = json.id

    } else if (template === 'photo_comment') {
      const photoRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: record.post.imageUrl, caption: record.post.title, access_token: token }),
      })
      const photoData = await photoRes.json() as any
      if (photoData.error) throw new Error(photoData.error.message ?? 'Facebook API error')
      platformPostId = photoData.id

      const commentRes = await fetch(`https://graph.facebook.com/v19.0/${photoData.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: link, access_token: token }),
      })
      const commentData = await commentRes.json() as any
      if (commentData.error) throw new Error(commentData.error.message ?? 'Facebook API error')

    } else if (template === 'text_link') {
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: caption + '\n\n' + link, access_token: token }),
      })
      const data = await res.json() as any
      if (data.error) throw new Error(data.error.message ?? 'Facebook API error')
      platformPostId = data.id
    }

    await db.socialPost.update({
      where: { id: socialPostId },
      data: { status: 'DONE', platformPostId: platformPostId ?? null, publishedAt: new Date() },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.socialPost.update({
      where: { id: socialPostId },
      data: { status: 'FAILED', error: message },
    })
  }
}

export function startSocialWorker() {
  const worker = new Worker<SocialJobData, any, string>(
    'social',
    async (job: Job<SocialJobData, any, string>) => {
      await processSocialPost(job.data.socialPostId)
    },
    { connection: redisOpts, concurrency: 3 },
  )

  worker.on('failed', (job: Job<SocialJobData> | undefined, err: Error) => {
    console.error(`[social-worker] job ${job?.id} failed:`, err.message)
  })

  return worker
}
