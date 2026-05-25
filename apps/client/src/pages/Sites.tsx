import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, TestTube, Globe, Loader2, Pencil } from 'lucide-react'
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

function SiteFormFields({
  form,
  setForm,
  passwordPlaceholder,
}: {
  form: Record<string, any>
  setForm: (fn: (p: any) => any) => void
  passwordPlaceholder?: string
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label>Name</Label>
        <Input placeholder="My News Site" value={form.name}
          onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
      </div>
      <div className="grid gap-1.5">
        <Label>Site URL</Label>
        <Input placeholder="https://example.com" value={form.url}
          onChange={e => setForm(p => ({ ...p, url: e.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>API User</Label>
          <Input placeholder="admin" value={form.apiUser}
            onChange={e => setForm(p => ({ ...p, apiUser: e.target.value }))} />
        </div>
        <div className="grid gap-1.5">
          <Label>API Password</Label>
          <Input type="password" placeholder={passwordPlaceholder ?? ''} value={form.apiPassword}
            onChange={e => setForm(p => ({ ...p, apiPassword: e.target.value }))} />
        </div>
      </div>
      <div className="border-t border-border pt-3 grid gap-3">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Publish defaults</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Default category <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input placeholder="Auto-imported" value={form.defaultCategory}
              onChange={e => setForm(p => ({ ...p, defaultCategory: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Default author ID <span className="text-muted-foreground font-normal">(WP user ID)</span></Label>
            <Input type="number" placeholder="1" value={form.defaultAuthorId}
              onChange={e => setForm(p => ({ ...p, defaultAuthorId: e.target.value }))} />
          </div>
        </div>
      </div>
    </>
  )
}

function AddSiteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', url: '', apiUser: '', apiPassword: '', defaultCategory: '', defaultAuthorId: '' })

  const create = useMutation({
    mutationFn: () => sitesApi.create({
      ...form,
      defaultCategory: form.defaultCategory || null,
      defaultAuthorId: form.defaultAuthorId ? Number(form.defaultAuthorId) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      toast.success('Site added')
      onClose()
      setForm({ name: '', url: '', apiUser: '', apiPassword: '', defaultCategory: '', defaultAuthorId: '' })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to add site'),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add WordPress Site</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <SiteFormFields form={form} setForm={setForm} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Add Site
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditSiteDialog({ site, onClose }: { site: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name:            site.name ?? '',
    url:             site.url ?? '',
    apiUser:         site.apiUser ?? '',
    apiPassword:     '',
    defaultCategory: site.defaultCategory ?? '',
    defaultAuthorId: site.defaultAuthorId ? String(site.defaultAuthorId) : '',
  })

  const update = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = {
        name:            form.name,
        url:             form.url,
        apiUser:         form.apiUser,
        defaultCategory: form.defaultCategory || null,
        defaultAuthorId: form.defaultAuthorId ? Number(form.defaultAuthorId) : null,
      }
      if (form.apiPassword) body.apiPassword = form.apiPassword
      return sitesApi.update(site.id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sites'] })
      toast.success('Site updated')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Update failed'),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Site</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <SiteFormFields form={form} setForm={setForm} passwordPlaceholder="Leave blank to keep" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Sites() {
  const [open, setOpen]           = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
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
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sites</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your WordPress publishing targets</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus />Add Site</Button>
      </div>

      <AddSiteDialog open={open} onClose={() => setOpen(false)} />
      {editTarget && <EditSiteDialog site={editTarget} onClose={() => setEditTarget(null)} />}

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
                    <p className="text-xs text-muted-foreground">
                      {site.lastPublished
                        ? `Last published ${formatDistanceToNow(new Date(site.lastPublished), { addSuffix: true })}`
                        : 'Never published'}
                      {site.defaultCategory && <> · Default cat: <span className="text-foreground">{site.defaultCategory}</span></>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={site.enabled ? 'success' : 'secondary'}>
                    {site.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                  <Switch
                    checked={site.enabled}
                    onCheckedChange={(enabled) => toggle.mutate({ id: site.id, enabled })}
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditTarget(site)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => test.mutate(site.id)} disabled={test.isPending}>
                    {test.isPending ? <Loader2 className="animate-spin" /> : <TestTube />}
                    Test
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove.mutate(site.id)}
                    className="text-muted-foreground hover:text-destructive">
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
