import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, RefreshCw, Rss, Zap, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { sourcesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

function AddSourceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', endpoint: '', type: 'RSS' as 'RSS' | 'WP_API' })

  const create = useMutation({
    mutationFn: () => sourcesApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      toast.success('Source added')
      onClose()
      setForm({ name: '', endpoint: '', type: 'RSS' })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to add source'),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Feed Source</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input placeholder="My News Source" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Endpoint URL</Label>
            <Input placeholder="https://example.com/feed" value={form.endpoint} onChange={e => setForm(p => ({ ...p, endpoint: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {(['RSS', 'WP_API'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setForm(p => ({ ...p, type: t }))}
                  className={`flex-1 rounded-md border py-2 text-sm transition-colors ${form.type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border/80'}`}
                >
                  {t === 'RSS' ? 'RSS Feed' : 'WP REST API'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Add Source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Sources() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list(),
  })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => sourcesApi.update(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sources'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => sourcesApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sources'] }); toast.success('Source removed') },
  })

  const fetchOne = useMutation({
    mutationFn: (id: string) => sourcesApi.fetch(id),
    onSuccess: () => toast.success('Fetch job queued'),
  })

  const fetchAll = useMutation({
    mutationFn: sourcesApi.fetchAll,
    onSuccess: (d) => toast.success(`${d.queued} sources queued for fetch`),
  })

  const sources = data?.items ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sources</h1>
          <p className="text-muted-foreground text-sm mt-1">{data?.total ?? 0} feed sources</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fetchAll.mutate()} disabled={fetchAll.isPending}>
            {fetchAll.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Fetch All
          </Button>
          <Button onClick={() => setOpen(true)}><Plus />Add Source</Button>
        </div>
      </div>

      <AddSourceDialog open={open} onClose={() => setOpen(false)} />

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : !sources.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Rss className="h-10 w-10 opacity-30" />
            <p>No sources yet. Add an RSS feed or WP REST API endpoint.</p>
            <Button variant="outline" onClick={() => setOpen(true)}><Plus />Add Source</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {sources.map((src: any) => (
            <Card key={src.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
                    <Rss className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{src.name}</p>
                      <Badge variant="outline" className="text-xs">{src.type}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate max-w-sm">{src.endpoint}</p>
                    <p className="text-xs text-muted-foreground">
                      {src.lastFetch
                        ? `Fetched ${formatDistanceToNow(new Date(src.lastFetch), { addSuffix: true })}`
                        : 'Never fetched'}
                      {' · '}{src._count?.posts ?? 0} posts
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={src.fetchStatus === 'OK' ? 'success' : src.fetchStatus === 'ERROR' ? 'destructive' : 'secondary'}>
                    {src.fetchStatus}
                  </Badge>
                  <Switch
                    checked={src.enabled}
                    onCheckedChange={(enabled) => toggle.mutate({ id: src.id, enabled })}
                  />
                  <Button
                    size="sm" variant="outline"
                    onClick={() => fetchOne.mutate(src.id)}
                    disabled={fetchOne.isPending}
                  >
                    {fetchOne.isPending ? <Loader2 className="animate-spin" /> : <Zap />}
                    Fetch
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(src.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
