import { S3Client, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { createHash } from 'crypto'
import { getSettingValue } from '../routes/settings.js'

interface StorageConfig {
  endpoint:    string
  region:      string
  accessKeyId: string
  secretKey:   string
  bucket:      string
  publicUrl:   string
}

let _client: S3Client | null = null
let _config: StorageConfig | null = null

async function loadConfig(): Promise<StorageConfig | null> {
  const [endpoint, region, accessKeyId, secretKey, bucket, publicUrl] = await Promise.all([
    getSettingValue('s3_endpoint'),
    getSettingValue('s3_region'),
    getSettingValue('s3_access_key'),
    getSettingValue('s3_secret_key'),
    getSettingValue('s3_bucket'),
    getSettingValue('s3_public_url'),
  ])
  if (!endpoint || !accessKeyId || !secretKey || !bucket) return null
  return { endpoint, region: region ?? 'auto', accessKeyId, secretKey, bucket, publicUrl: publicUrl ?? '' }
}

function getClient(config: StorageConfig): S3Client {
  if (!_client || JSON.stringify(_config) !== JSON.stringify(config)) {
    _client = new S3Client({
      endpoint:    config.endpoint,
      region:      config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretKey },
      forcePathStyle: true,
    })
    _config = config
  }
  return _client
}

export async function uploadImage(
  buffer: Buffer,
  mimeType: string,
  originalUrl: string,
): Promise<string | null> {
  const config = await loadConfig()
  if (!config) return null

  try {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    const ext  = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'
    const key  = `images/${hash}.${ext}`

    const client = getClient(config)
    await client.send(new PutObjectCommand({
      Bucket:      config.bucket,
      Key:         key,
      Body:        buffer,
      ContentType: mimeType,
      CacheControl: 'public, max-age=31536000, immutable',
    }))

    if (config.publicUrl) return `${config.publicUrl.replace(/\/$/, '')}/${key}`
    return `${config.endpoint.replace(/\/$/, '')}/${config.bucket}/${key}`
  } catch (err) {
    console.warn('[image-storage] upload failed:', (err as Error).message)
    return null
  }
}

export async function testStorageConnection(): Promise<{ ok: boolean; error?: string }> {
  const config = await loadConfig()
  if (!config) return { ok: false, error: 'Not configured' }
  try {
    const client = getClient(config)
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
