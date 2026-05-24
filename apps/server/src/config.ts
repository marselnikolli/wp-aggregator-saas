import { z } from 'zod'

const schema = z.object({
  DATABASE_URL:    z.string().url(),
  REDIS_URL:       z.string().url().default('redis://localhost:6379'),
  JWT_SECRET:      z.string().min(16),
  ENCRYPTION_KEY:  z.string().min(16),
  PORT:            z.coerce.number().default(3001),
  CORS_ORIGIN:     z.string().default('http://localhost:5173'),
  OPENAI_API_KEY:  z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  NODE_ENV:        z.enum(['development', 'production', 'test']).default('development'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data
