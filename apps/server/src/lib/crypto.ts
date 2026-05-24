import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'
import { config } from '../config.js'

function getKey(): Buffer {
  return createHash('sha256').update(config.ENCRYPTION_KEY).digest()
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decrypt(ciphertext: string): string {
  const [ivHex, encHex] = ciphertext.split(':')
  if (!ivHex || !encHex) return ciphertext
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv('aes-256-cbc', getKey(), iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
