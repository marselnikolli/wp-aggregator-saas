import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { ExternalLink, RefreshCw, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { postsApi, sitesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const STATUS_VARIANTS: Record<string, 'success' | 'destructive' | 'secondary' | 'outline'> = {
  DONE:       'success',
  FAILED:     'destructive',
  PROCESSING: 'secondary',
  PENDING:    'outline',
}

export function PublishHistory() {
  const qc = useQueryClient()
  const [page, setPage]       = useState(1)
  const [status, setStatus]   = useState<string>('')
  const [siteId, setSiteId]   = useState<string>('')

  const { data, isLoading } = useQuery({
    queryKey: ['publish-tasks', page, status, siteId],
    queryFn:  () => postsApi.publishTasks({ page, per_page: 25, ...(status && { status }), ...(siteId && { siteId }) }),
    refetchInterval: (q) => q.state.data?.items?.some((t: any) => t.status === 'PROCESSING' || t.status === 'PENDING') ? 8_000 : false,
  })

  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })

  const retry = useMutation({
    mutationFn: (id: string) => postsApi.retryPublishTask(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['publish-tasks'] }); toast.success('Task re-queued') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Retry failed'),
  })

  const items      = data?.items ?? []
  const totalPages = data?.pages ?? 1

  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Publish History</h1>
          <p className="text-muted-foreground text-sm mt-1">All publish tasks — completed, failed, and in-progress</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['publish-tasks'] })}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['', 'DONE', 'FAILED', 'PROCESSING', 'PENDING'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1) }}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              status === s
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}>
            {s || 'All'}
          </button>
        ))}
        {sites?.length > 0 && (
          <select value={siteId} onChange={e => { setSiteId(e.target.value); setPage(1) }}
            className="rounded-full px-3 py-1 text-xs border border-border bg-background text-muted-foreground">
            <option value="">All sites</option>
            {sites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !items.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <p className="text-sm">No publish tasks{status ? ` with status ${status}` : ''} found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((task: any) => (
            <Card key={task.id}>
              <CardContent className="flex items-center justify-between p-4 gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{task.post?.title ?? '—'}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-muted-foreground">{task.site?.name ?? '—'}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
                    </span>
                    {task.attempts > 1 && (
                      <span className="text-xs text-muted-foreground">· {task.attempts} attempts</span>
                    )}
                    {task.error && (
                      <span className="text-xs text-red-400 truncate max-w-xs" title={task.error}>{task.error}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={STATUS_VARIANTS[task.status] ?? 'secondary'}>
                    {task.status === 'PROCESSING' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    {task.status}
                  </Badge>
                  {task.wpUrl && (
                    <a href={task.wpUrl} target="_blank" rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {task.status === 'FAILED' && (
                    <Button size="sm" variant="outline" onClick={() => retry.mutate(task.id)} disabled={retry.isPending}>
                      {retry.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Retry
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
