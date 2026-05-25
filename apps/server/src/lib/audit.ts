import { db } from '../db.js'

export type AuditAction =
  | 'post.approve'
  | 'post.reject'
  | 'post.publish'
  | 'post.delete'
  | 'post.update'
  | 'source.create'
  | 'source.update'
  | 'source.delete'
  | 'source.fetch'
  | 'site.create'
  | 'site.update'
  | 'site.delete'
  | 'settings.update'
  | 'auth.login'
  | 'auth.totp.enable'
  | 'auth.totp.disable'

export interface AuditContext {
  userId?:       string
  userEmail?:    string
  resourceType?: string
  resourceId?:   string
  metadata?:     Record<string, unknown>
}

export async function audit(action: AuditAction, ctx: AuditContext = {}) {
  const [prefix] = action.split('.')
  await db.auditLog.create({
    data: {
      action,
      userId:       ctx.userId ?? null,
      userEmail:    ctx.userEmail ?? null,
      resourceType: ctx.resourceType ?? prefix,
      resourceId:   ctx.resourceId ?? null,
      metadata:     ctx.metadata ? (ctx.metadata as any) : null,
    },
  }).catch(() => { /* non-fatal — never block the request */ })
}
