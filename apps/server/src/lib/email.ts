import { createConnection } from 'net'
import { connect as tlsConnect } from 'tls'
import { db } from '../db.js'

interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

interface EmailPayload {
  to: string
  subject: string
  text: string
  smtp?: SmtpConfig
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const [host, port, user, pass, from] = await Promise.all([
    db.setting.findUnique({ where: { key: 'smtp_host' } }),
    db.setting.findUnique({ where: { key: 'smtp_port' } }),
    db.setting.findUnique({ where: { key: 'smtp_user' } }),
    db.setting.findUnique({ where: { key: 'smtp_pass' } }),
    db.setting.findUnique({ where: { key: 'smtp_from' } }),
  ])
  if (!host?.value || !from?.value) return null
  return {
    host: host.value,
    port: port ? Number(port.value) : 587,
    user: user?.value ?? '',
    pass: pass?.value ?? '',
    from: from.value,
  }
}

function base64Encode(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64')
}

async function smtpSend(config: SmtpConfig, to: string, subject: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const useTls = config.port === 465
    const socket = useTls
      ? tlsConnect(config.port, config.host, { servername: config.host })
      : createConnection(config.port, config.host)

    let buffer = ''
    let step = 0
    let timeout: NodeJS.Timeout

    const resetTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        socket.destroy()
        reject(new Error('SMTP timeout'))
      }, 10000)
    }

    const send = (cmd: string) => {
      socket.write(cmd + '\r\n')
    }

    const onData = (data: Buffer) => {
      buffer += data.toString()
      if (!buffer.includes('\r\n')) return

      const lines = buffer.split('\r\n')
      buffer = lines.pop() ?? ''
      const code = parseInt(lines[0].slice(0, 3), 10)

      const isContinuation = lines.some(l => l.length >= 4 && l[3] === '-')
      if (isContinuation) return

      if (code >= 500) {
        socket.destroy()
        reject(new Error(`SMTP error: ${lines.join(' ')}`))
        return
      }

      resetTimeout()
      step++

      switch (step) {
        case 1:
          send(`EHLO wp-aggregator`)
          break
        case 2:
          if (!useTls && config.user) {
            send('STARTTLS')
          } else if (config.user) {
            send('AUTH LOGIN')
          } else {
            send(`MAIL FROM:<${config.from}>`)
          }
          break
        case 3:
          if (!useTls && config.user) {
            socket.unpipe()
            const tlsSocket = tlsConnect({ socket, servername: config.host })
            tlsSocket.on('data', (d: Buffer) => {
              const resp = d.toString()
              if (resp.startsWith('220')) {
                tlsSocket.write(`EHLO wp-aggregator\r\n`)
                step = 3
              } else if (resp.includes('250 ')) {
                step = 4
                onData(Buffer.from('334 \r\n'))
              }
            })
            tlsSocket.on('error', reject)
            return
          }
          send(base64Encode(config.user))
          break
        case 4:
          if (config.user) {
            send(base64Encode(config.pass))
          } else {
            send(`RCPT TO:<${to}>`)
          }
          break
        case 5:
          if (config.user) {
            send(`MAIL FROM:<${config.from}>`)
          } else {
            send('DATA')
          }
          break
        case 6:
          send(`RCPT TO:<${to}>`)
          break
        case 7:
          send('DATA')
          break
        case 8:
          send(`From: ${config.from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n.`)
          break
        case 9:
          socket.end()
          resolve()
          break
      }
    }

    socket.on('data', onData)
    socket.on('error', reject)
    socket.on('connect', resetTimeout)
    resetTimeout()
  })
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const config = payload.smtp ?? await getSmtpConfig()
  if (!config) throw new Error('SMTP not configured')

  await smtpSend(config, payload.to, payload.subject, payload.text)
}

export async function sendSourceBrokenAlert(sourceName: string, endpoint: string, error: string, errorCount: number): Promise<void> {
  const [enabledRow, emailRow] = await Promise.all([
    db.setting.findUnique({ where: { key: 'notif_on_error' } }),
    db.setting.findUnique({ where: { key: 'notif_email' } }),
  ])

  if (enabledRow?.value !== 'true' || !emailRow?.value) return

  try {
    await sendEmail({
      to: emailRow.value,
      subject: `[WP Aggregator] Source broken: ${sourceName}`,
      text: [
        `A source has failed ${errorCount} consecutive times.`,
        ``,
        `Source: ${sourceName}`,
        `Endpoint: ${endpoint}`,
        `Last error: ${error}`,
        `Error count: ${errorCount}`,
        `Time: ${new Date().toISOString()}`,
        ``,
        `Please check the source settings in WP Aggregator.`,
      ].join('\n'),
    })
    console.log(`[alert] Email sent for broken source "${sourceName}"`)
  } catch (err) {
    console.error(`[alert] Failed to send email for broken source "${sourceName}":`, (err as Error).message)
  }
}
