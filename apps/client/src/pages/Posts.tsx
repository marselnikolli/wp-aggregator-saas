import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Upload, Trash2, FileText, Loader2, ExternalLink } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { postsApi, sitesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'

function PublishDialog({ post, open, onClose }: { post: any; open: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })
  const qc = useQueryClient()

  const publish = useMutation({
    mutationFn: () => postsApi.publish(post.id, selected),
    onSuccess: (d) => {
      toast.success(`Queued for ${d.queued} site(s)`)
      qc.invalidateQueries({ queryKey: ['posts'] })
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Publish failed'),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish to Sites</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-sm text-muted-foreground">Select destination sites for: <strong>{post?.title}</strong></p>
          {sites?.map((site: any) => (
            <label key={site.id} className="flex items-center gap-3 rounded-md border border-border p-3 cursor-pointer hover:bg-secondary/50">
              <Switch
                checked={selected.includes(site.id)}
                onCheckedChange={(c) => setSelected(p => c ? [...p, site.id] : p.filter(i => i !== site.id))}
              />
              <div>
                <p className="text-sm font-medium">{site.name}</p>
                <p className="text-xs text-muted-foreground">{site.url}</p>
              </div>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => publish.mutate()} disabled={!selected.length || publish.isPending}>
            {publish.isPending && <Loader2 className="animate-spin" />}
            Publish to {selected.length} site{selected.length !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PostsList({ approvalStatus }: { approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' }) {
  const [publishTarget, setPublishTarget] = useState<any>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['posts', approvalStatus],
    queryFn: () => postsApi.list({ approvalStatus, per_page: 50 }),
    refetchInterval: 15_000,
  })

  const approve = useMutation({
    mutationFn: (id: string) => postsApi.approve(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['posts'] }); toast.success('Post approved') },
  })
  const reject = useMutation({
    mutationFn: (id: string) => postsApi.reject(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['posts'] }); toast.success('Post rejected') },
  })
  const remove = useMutation({
    mutationFn: (id: string) => postsApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['posts'] }); toast.success('Post deleted') },
  })

  if (isLoading) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>

  const posts = data?.items ?? []
  if (!posts.length) return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
      <FileText className="h-10 w-10 opacity-30" />
      <p>No {approvalStatus.toLowerCase()} posts.</p>
    </div>
  )

  return (
    <>
      {publishTarget && (
        <PublishDialog post={publishTarget} open={!!publishTarget} onClose={() => setPublishTarget(null)} />
      )}
      <div className="space-y-2">
        {posts.map((post: any) => (
          <Card key={post.id}>
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm truncate">{post.title}</p>
                  {post.publishStatus === 'PUBLISHED' && <Badge variant="success">Published</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {post.source?.name} · {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                </p>
                {post.excerpt && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{post.excerpt.replace(/<[^>]+>/g, '')}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {post.originalUrl && (
                  <Button size="icon" variant="ghost" asChild>
                    <a href={post.originalUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                {approvalStatus === 'PENDING' && (
                  <>
                    <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10" onClick={() => approve.mutate(post.id)}>
                      <CheckCircle />Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-400 border-red-400/30 hover:bg-red-400/10" onClick={() => reject.mutate(post.id)}>
                      <XCircle />Reject
                    </Button>
                  </>
                )}
                {approvalStatus === 'APPROVED' && post.publishStatus !== 'PUBLISHED' && (
                  <Button size="sm" onClick={() => setPublishTarget(post)}>
                    <Upload />Publish
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(post.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}

export function Posts() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Posts</h1>
        <p className="text-muted-foreground text-sm mt-1">Review and publish aggregated content</p>
      </div>

      <Tabs defaultValue="PENDING">
        <TabsList>
          <TabsTrigger value="PENDING">Pending</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value="PENDING">  <PostsList approvalStatus="PENDING" /></TabsContent>
        <TabsContent value="APPROVED"> <PostsList approvalStatus="APPROVED" /></TabsContent>
        <TabsContent value="REJECTED"> <PostsList approvalStatus="REJECTED" /></TabsContent>
      </Tabs>
    </div>
  )
}
