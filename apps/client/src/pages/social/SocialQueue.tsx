import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { RefreshCw, Loader2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { socialApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const STATUS_VARIANTS: Record<string, 'success' | 'destructive' | 'secondary' | 'outline'> = {
  DONE:       'success',
  FAILED:     'destructive',
  PROCESSING: 'secondary',
  PENDING:    'outline',
  SCHEDULED:  'outline',
  CANCELLED:  'secondary',
}

const PLATFORM_CLASS: Record<string, string> = {
  FACEBOOK:  'bg-blue-600 text-white',
  INSTAGRAM: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white',
}

const TEMPLATE_LABELS: Record<string, string> = {
  photo_comment: 'Photo + comment',
  link_post:     'Link post',
  photo_only:    'Photo only',
  text_link:     'Text + link',
  image_overlay: 'Image overlay',
}

export function SocialQueue() {
  const qc = useQueryClient()
  const [page, setPage]         = useState(1)
  const [status, setStatus]     = useState('')
  const [platform, setPlatform] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['social-history', page, status, platform],
    queryFn:  () => socialApi.history({
      page, limit: 25,
      ...(status   && { status }),
      ...(platform && { platform }),
    }),
    refetchInterval: (q) =>
      q.state.data?.items?.some((t: any) => t.status === 'PROCESSING' || t.status === 'PENDING')
        ? 8_000 : false,
  })

  const retry = useMutation({
    mutationFn: (id: string) => socialApi.retryPost(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-history'] }); toast.success('Re-queued') },
    onError:   (e: any) => toast.error(e.response?.data?.error ?? 'Retry failed'),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => socialApi.cancelPost(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-history'] }); toast.success('Cancelled') },
    onError:   (e: any) => toast.error(e.response?.data?.error ?? 'Cancel failed'),
  })

  const items      = data?.items ?? []
  const totalPages = data?.pages ?? 1

  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Social Queue</h1>
          <p className="text-muted-foreground text-sm mt-1">Scheduled and published social media posts</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['social-history'] })}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['', 'DONE', 'FAILED', 'PROCESSING', 'PENDING', 'SCHEDULED'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1) }}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              status === s
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}>
            {s || 'All'}
          </button>
        ))}
        <select value={platform} onChange={e => { setPlatform(e.target.value); setPage(1) }}
          className="rounded-full px-3 py-1 text-xs border border-border bg-background text-muted-foreground">
          <option value="">All platforms</option>
          <option value="FACEBOOK">Facebook</option>
          <option value="INSTAGRAM">Instagram</option>
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : !items.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <p className="text-sm">No social posts{status ? ` with status ${status}` : ''} found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((post: any) => (
            <Card key={post.id}>
              <CardContent className="flex items-center justify-between p-4 gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{post.post?.title ?? '—'}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PLATFORM_CLASS[post.account?.platform] ?? 'bg-muted text-muted-foreground'}`}>
                      {post.account?.platform}
                    </span>
                    <span className="text-xs text-muted-foreground">{post.account?.name ?? '—'}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground bg-secondary rounded px-1.5 py-0.5">
                      {TEMPLATE_LABELS[post.template] ?? post.template}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                    </span>
                    {post.error && (
                      <span className="text-xs text-red-400 truncate max-w-xs" title={post.error}>{post.error}</span>
                    )}
                    {post.engagement != null && (
                      <span className="text-xs text-muted-foreground">· {post.engagement} engagements</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={STATUS_VARIANTS[post.status] ?? 'secondary'}>
                    {post.status === 'PROCESSING' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                    {post.status}
                  </Badge>
                  {post.status === 'FAILED' && (
                    <Button size="sm" variant="outline" onClick={() => retry.mutate(post.id)} disabled={retry.isPending}>
                      {retry.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Retry
                    </Button>
                  )}
                  {(post.status === 'SCHEDULED' || post.status === 'PENDING') && (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                      onClick={() => cancel.mutate(post.id)} disabled={cancel.isPending}>
                      <X className="h-3 w-3" />
                      Cancel
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
