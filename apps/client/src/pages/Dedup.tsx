import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, ExternalLink, CheckCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { dedupApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
export function Dedup() {
  const [page, setPage] = useState(1)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['dedup', page],
    queryFn: () => dedupApi.list({ page, per_page: 25 }),
    placeholderData: (prev: any) => prev,
    refetchInterval: 15_000,
  })

  const items = data?.items ?? []
  const totalPages = data?.pages ?? 1
  const total = data?.total ?? 0

  const markUnique = useMutation({
    mutationFn: (id: string) => dedupApi.markUnique(id),
    onSuccess: () => {
      toast.success('Marked as unique — post re-queued')
      qc.invalidateQueries({ queryKey: ['dedup'] })
      qc.invalidateQueries({ queryKey: ['posts'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed'),
  })

  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Duplicate Detection</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Posts flagged as semantic duplicates — review and override if needed
          </p>
        </div>
        <Badge variant="outline" className="text-xs">{total} duplicates</Badge>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-md" />)}</div>
      ) : !items.length ? (
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground py-16">
          <CheckCircle className="h-10 w-10 opacity-25" />
          <p className="text-sm">No duplicate posts found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((post: any) => (
            <div key={post.id} className="rounded-lg border border-border p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{post.aiTitle ?? post.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {post.source?.name}
                    {' · '}{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                    {post.language && post.language !== 'en' && <> · <span className="font-mono">{post.language}</span></>}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={() => markUnique.mutate(post.id)}
                  disabled={markUnique.isPending}
                >
                  {markUnique.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Mark as unique
                </Button>
              </div>

              {post.parent && (
                <div className="rounded-md bg-secondary/50 border border-border/50 p-2.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">Duplicate of:</span>{' '}
                  {post.parent.title}
                  {post.parent.originalUrl && (
                    <a href={post.parent.originalUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-primary hover:underline ml-1.5">
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                  <span className="ml-1.5 opacity-50">
                    · {formatDistanceToNow(new Date(post.parent.createdAt), { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
