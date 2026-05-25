import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, ShieldCheck } from 'lucide-react'
import { auditApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface AuditEntry {
  id:           string
  userId:       string | null
  userEmail:    string | null
  action:       string
  resourceType: string
  resourceId:   string | null
  metadata:     Record<string, unknown> | null
  createdAt:    string
}

const ACTION_COLORS: Record<string, string> = {
  'post.approve':  'bg-emerald-100 text-emerald-800',
  'post.reject':   'bg-red-100 text-red-800',
  'post.publish':  'bg-blue-100 text-blue-800',
  'post.delete':   'bg-red-200 text-red-900',
  'post.update':   'bg-yellow-100 text-yellow-800',
  'source.create': 'bg-violet-100 text-violet-800',
  'source.delete': 'bg-red-100 text-red-800',
  'source.fetch':  'bg-sky-100 text-sky-800',
  'auth.login':    'bg-gray-100 text-gray-700',
  'settings.update': 'bg-orange-100 text-orange-800',
}

function formatMeta(meta: Record<string, unknown> | null): string {
  if (!meta) return ''
  const parts: string[] = []
  if (meta.title) parts.push(`"${String(meta.title).slice(0, 60)}"`)
  if (meta.name)  parts.push(`"${meta.name}"`)
  if (meta.type)  parts.push(String(meta.type))
  if (meta.siteIds && Array.isArray(meta.siteIds)) parts.push(`→ ${meta.siteIds.length} site(s)`)
  if (meta.wpStatus) parts.push(String(meta.wpStatus))
  if (meta.ip)    parts.push(`from ${meta.ip}`)
  return parts.join(' · ')
}

export function AuditLog() {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', page],
    queryFn: () => auditApi.list({ page, per_page: 50 }),
  })

  const entries: AuditEntry[] = data?.items ?? []
  const totalPages: number = data?.pages ?? 1

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Audit Log</h1>
        {data?.total != null && (
          <span className="text-sm text-muted-foreground ml-1">({data.total} events)</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No events recorded yet
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium w-40">Time</th>
                <th className="px-4 py-2 font-medium w-36">Action</th>
                <th className="px-4 py-2 font-medium w-36">User</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map(entry => (
                <tr key={entry.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap font-mono text-xs">
                    {new Date(entry.createdAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-700'}`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[9rem]">
                    {entry.userEmail ?? entry.userId ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {entry.resourceId && (
                      <Badge variant="outline" className="text-[10px] h-4 mr-1.5 font-mono">
                        {entry.resourceId.slice(-8)}
                      </Badge>
                    )}
                    {formatMeta(entry.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t text-sm">
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  )
}
