import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, TestTube, Globe, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { sitesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

function AddSiteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', url: '', apiUser: '', apiPassword: '' })

  const create = useMutation({
    mutationFn: () => sitesApi.create(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      toast.success('Site added')
      onClose()
      setForm({ name: '', url: '', apiUser: '', apiPassword: '' })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to add site'),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add WordPress Site</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {(['name', 'url', 'apiUser', 'apiPassword'] as const).map((f) => (
            <div key={f} className="grid gap-1.5">
              <Label htmlFor={f} className="capitalize">{f.replace('api', 'API ')}</Label>
              <Input
                id={f}
                type={f === 'apiPassword' ? 'password' : 'text'}
                placeholder={f === 'url' ? 'https://example.com' : f === 'apiUser' ? 'admin' : ''}
                value={form[f]}
                onChange={(e) => setForm(p => ({ ...p, [f]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />}
            Add Site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Sites() {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const { data: sites, isLoading } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      sitesApi.update(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sites'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => sitesApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sites'] }); toast.success('Site removed') },
  })

  const test = useMutation({
    mutationFn: (id: string) => sitesApi.test(id),
    onSuccess: (d) => d.ok ? toast.success('Connection OK') : toast.error('Connection failed'),
    onError: () => toast.error('Connection failed'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sites</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your WordPress publishing targets</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus />Add Site</Button>
      </div>

      <AddSiteDialog open={open} onClose={() => setOpen(false)} />

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : !sites?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Globe className="h-10 w-10 opacity-30" />
            <p>No sites yet. Add your first WordPress site.</p>
            <Button variant="outline" onClick={() => setOpen(true)}><Plus />Add Site</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {sites.map((site: any) => (
            <Card key={site.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{site.name}</p>
                    <p className="text-xs text-muted-foreground">{site.url}</p>
                    {site.lastPublished && (
                      <p className="text-xs text-muted-foreground">
                        Last published {formatDistanceToNow(new Date(site.lastPublished), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={site.enabled ? 'success' : 'secondary'}>
                    {site.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                  <Switch
                    checked={site.enabled}
                    onCheckedChange={(enabled) => toggle.mutate({ id: site.id, enabled })}
                  />
                  <Button
                    size="sm" variant="outline"
                    onClick={() => test.mutate(site.id)}
                    disabled={test.isPending}
                  >
                    {test.isPending ? <Loader2 className="animate-spin" /> : <TestTube />}
                    Test
                  </Button>
                  <Button
                    size="icon" variant="ghost"
                    onClick={() => remove.mutate(site.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
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
