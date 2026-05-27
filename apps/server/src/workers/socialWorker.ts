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

// Instagram 2-step container flow: create media → publish
async function igPublishPhoto(igUserId: string, imageUrl: string, caption: string, token: string): Promise<string> {
  const containerRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
  })
  const container = await containerRes.json() as any
  if (container.error) throw new Error(container.error.message ?? 'Instagram media container error')

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: token }),
  })
  const published = await publishRes.json() as any
  if (published.error) throw new Error(published.error.message ?? 'Instagram media_publish error')
  return published.id
}

async function fetchPostInsights(socialPostId: string): Promise<void> {
  try {
    const record = await db.socialPost.findUnique({
      where: { id: socialPostId },
      include: { account: true },
    })
    if (!record?.platformPostId || !record?.account?.accessToken) return

    const token = decrypt(record.account.accessToken)
    const platform = record.platform

    let reach = 0
    let impressions = 0
    let engagement = 0

    if (platform === 'INSTAGRAM') {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${record.platformPostId}/insights?metric=impressions,reach,engagement&access_token=${token}`,
      )
      const data = await res.json() as any
      if (!data.error && data.data) {
        for (const metric of data.data) {
          if (metric.name === 'impressions') impressions = metric.values?.[0]?.value ?? 0
          if (metric.name === 'reach')      reach      = metric.values?.[0]?.value ?? 0
          if (metric.name === 'engagement') engagement = metric.values?.[0]?.value ?? 0
        }
      }
    } else {
      const [reachRes, engagedRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v19.0/${record.platformPostId}/insights/post_impressions_unique?access_token=${token}`),
        fetch(`https://graph.facebook.com/v19.0/${record.platformPostId}/insights/post_engaged_users?access_token=${token}`),
      ])
      const [reachData, engagedData] = await Promise.all([reachRes.json(), engagedRes.json()]) as [any, any]
      if (!reachData.error)   reach      = reachData.data?.[0]?.values?.[0]?.value ?? 0
      if (!engagedData.error) engagement = engagedData.data?.[0]?.values?.[0]?.value ?? 0
      // Facebook impressions: use total_impressions_unique or post_impressions
      const imprRes = await fetch(`https://graph.facebook.com/v19.0/${record.platformPostId}/insights/post_impressions?access_token=${token}`)
      const imprData = await imprRes.json() as any
      if (!imprData.error) impressions = imprData.data?.[0]?.values?.[0]?.value ?? 0
    }

    await db.socialPost.update({
      where: { id: socialPostId },
      data: { reach, impressions, engagement },
    })
  } catch {
    // best-effort analytics fetch; insights may not be available immediately
  }
}

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

    const platform = record.account.platform

    if (template === 'link_post') {
      if (platform === 'INSTAGRAM') {
        // Instagram doesn't support link posts — fall back to caption-only image post if image available
        if (!record.post.imageUrl) throw new Error('Instagram link_post requires a featured image')
        platformPostId = await igPublishPhoto(pageId, record.post.imageUrl, caption + '\n\n' + link, token)
      } else {
        const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: caption, link, access_token: token }),
        })
        const data = await res.json() as any
        if (data.error) throw new Error(data.error.message ?? 'Facebook API error')
        platformPostId = data.id
      }

    } else if (template === 'photo_only') {
      if (platform === 'INSTAGRAM') {
        if (!record.post.imageUrl) throw new Error('Instagram photo_only requires a featured image')
        platformPostId = await igPublishPhoto(pageId, record.post.imageUrl, record.post.title, token)
      } else {
        const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: record.post.imageUrl, caption: record.post.title, access_token: token }),
        })
        const data = await res.json() as any
        if (data.error) throw new Error(data.error.message ?? 'Facebook API error')
        platformPostId = data.id
      }

    } else if (template === 'image_overlay') {
      const imgBuffer = await generateSocialImage({
        title:          record.post.title,
        categories:     record.post.categories,
        imageUrl:       record.post.imageUrl ?? undefined,
        categoryColors: captionTemplate ? (captionTemplate.categoryColors as Record<string, string> ?? {}) : {},
      })
      const imgUrl = await uploadSocialImage(imgBuffer, record.post.id)
      if (platform === 'INSTAGRAM') {
        platformPostId = await igPublishPhoto(pageId, imgUrl, caption, token)
      } else {
        const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: imgUrl, caption: record.post.title, access_token: token }),
        })
        const json = await res.json() as any
        if (json.error) throw new Error(json.error.message)
        platformPostId = json.id
      }

    } else if (template === 'photo_comment') {
      if (platform === 'INSTAGRAM') {
        if (!record.post.imageUrl) throw new Error('Instagram photo_comment requires a featured image')
        platformPostId = await igPublishPhoto(pageId, record.post.imageUrl, caption + '\n\n' + link, token)
      } else {
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
      }

    } else if (template === 'text_link') {
      if (platform === 'INSTAGRAM') {
        // Instagram has no text-only posts — requires an image
        if (!record.post.imageUrl) throw new Error('Instagram text_link requires a featured image')
        platformPostId = await igPublishPhoto(pageId, record.post.imageUrl, caption + '\n\n' + link, token)
      } else {
        const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: caption + '\n\n' + link, access_token: token }),
        })
        const data = await res.json() as any
        if (data.error) throw new Error(data.error.message ?? 'Facebook API error')
        platformPostId = data.id
      }
    }

    await db.socialPost.update({
      where: { id: socialPostId },
      data: { status: 'DONE', platformPostId: platformPostId ?? null, publishedAt: new Date() },
    })

    // Schedule analytics fetch 5 minutes after publish (insights need time to generate)
    if (platformPostId) {
      setTimeout(() => fetchPostInsights(socialPostId).catch(() => {}), 5 * 60 * 1000)
    }
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
