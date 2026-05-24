import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, RefreshCw, Rss, Zap, Loader2, Upload, FileUp, ChevronLeft, ChevronRight, CheckCircle, XCircle, Pencil, Search } from 'lucide-react'
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

const INTERVALS = [
  { value: '',    label: 'Disabled'      },
  { value: '15m', label: 'Every 15 min'  },
  { value: '1h',  label: 'Every hour'    },
  { value: '6h',  label: 'Every 6 hours' },
  { value: '24h', label: 'Daily'         },
]

function DetectButton({ url, onDetect }: { url: string; onDetect: (result: any) => void }) {
  const detect = useMutation({
    mutationFn: () => sourcesApi.detect(url),
    onSuccess: (d) => { onDetect(d); toast.success(`Detected: ${d.type}`) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Detection failed'),
  })
  return (
    <Button type="button" size="sm" variant="outline" className="shrink-0"
      onClick={() => detect.mutate()} disabled={!url.trim() || detect.isPending}>
      {detect.isPending ? <Loader2 className="animate-spin" /> : <Search />}
      Detect
    </Button>
  )
}

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

  function handleDetect(result: { type: string; endpoint: string; name: string }) {
    setForm(p => ({
      ...p,
      endpoint: result.endpoint,
      type: result.type as 'RSS' | 'WP_API',
      name: p.name || result.name,
    }))
  }

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
            <div className="flex gap-2">
              <Input placeholder="https://example.com/feed" value={form.endpoint}
                onChange={e => setForm(p => ({ ...p, endpoint: e.target.value }))} />
              <DetectButton url={form.endpoint} onDetect={handleDetect} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {(['RSS', 'WP_API'] as const).map(t => (
                <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))}
                  className={`flex-1 rounded-md border py-2 text-sm transition-colors ${form.type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border/80'}`}>
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

function EditSourceDialog({ source, onClose }: { source: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name:     source.name ?? '',
    endpoint: source.endpoint ?? '',
    type:     source.type as 'RSS' | 'WP_API',
    interval: source.interval ?? '',
    username: source.username ?? '',
    password: '',
  })

  const update = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = {
        name:     form.name,
        endpoint: form.endpoint,
        type:     form.type,
        interval: form.interval || null,
        username: form.username || null,
      }
      if (form.password) body.password = form.password
      return sourcesApi.update(source.id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      toast.success('Source updated')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Update failed'),
  })

  function handleDetect(result: { type: string; endpoint: string; name: string }) {
    setForm(p => ({
      ...p,
      endpoint: result.endpoint,
      type: result.type as 'RSS' | 'WP_API',
      name: p.name || result.name,
    }))
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Source</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Endpoint URL</Label>
            <div className="flex gap-2">
              <Input value={form.endpoint} onChange={e => setForm(p => ({ ...p, endpoint: e.target.value }))} />
              <DetectButton url={form.endpoint} onDetect={handleDetect} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {(['RSS', 'WP_API'] as const).map(t => (
                <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))}
                  className={`flex-1 rounded-md border py-2 text-sm transition-colors ${form.type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border/80'}`}>
                  {t === 'RSS' ? 'RSS Feed' : 'WP REST API'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Auto-fetch interval</Label>
            <select value={form.interval} onChange={e => setForm(p => ({ ...p, interval: e.target.value }))}
              className="h-9 rounded-md border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Username <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                placeholder="wp-user" />
            </div>
            <div className="grid gap-1.5">
              <Label>Password <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder={source.username ? 'Leave blank to keep' : 'App password'} />
            </div>
          </div>
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

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [results, setResults] = useState<{ created: number; duplicates: number; errors: number; items: any[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const importMut = useMutation({
    mutationFn: (urls: string[]) => sourcesApi.import(urls),
    onSuccess: (d) => {
      setResults({ created: d.created, duplicates: d.duplicates, errors: d.errors, items: d.results })
      qc.invalidateQueries({ queryKey: ['sources'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Import failed'),
  })

  function handleSubmit() {
    const urls = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (!urls.length) { toast.error('No URLs found'); return }
    importMut.mutate(urls)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setText(ev.target?.result as string ?? '')
    reader.readAsText(file)
  }

  function handleClose() {
    setText(''); setResults(null)
    if (fileRef.current) fileRef.current.value = ''
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Import WordPress Sources</DialogTitle></DialogHeader>
        {!results ? (
          <>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">Paste one WordPress site URL per line. Each will be added as a WP REST API source.</p>
              <textarea
                className="w-full h-40 rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                placeholder={"https://site1.com\nhttps://site2.com\nhttps://site3.com"}
                value={text} onChange={e => setText(e.target.value)} />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <FileUp className="h-4 w-4" />Load .txt file
                </Button>
                <span className="text-xs text-muted-foreground">or paste URLs above</span>
                <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={handleFile} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!text.trim() || importMut.isPending}>
                {importMut.isPending && <Loader2 className="animate-spin" />}
                <Upload />Import
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-400">{results.created}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Added</p>
                </div>
                <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-400">{results.duplicates}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Duplicate</p>
                </div>
                <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">{results.errors}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Error</p>
                </div>
              </div>
              {results.errors > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {results.items.filter(r => r.status === 'error').map((r, i) => (
                    <p key={i} className="text-xs text-red-400 font-mono truncate">{r.url}: {r.error}</p>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter><Button onClick={handleClose}>Done</Button></DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function Sources() {
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [activeJobs, setActiveJobs] = useState<Record<string, 'active' | 'completed' | 'failed'>>({})
  const qc = useQueryClient()

  useEffect(() => {
    const controller = new AbortController()

    async function connect() {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/sources/events', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) return

        const reader  = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.split('\n').find(l => l.startsWith('data:'))
            if (!line) continue
            try {
              const ev = JSON.parse(line.slice(5).trim()) as {
                type: 'job:active' | 'job:completed' | 'job:failed'
                sourceId: string
              }
              const status = ev.type === 'job:active' ? 'active' : ev.type === 'job:completed' ? 'completed' : 'failed'
              setActiveJobs(prev => ({ ...prev, [ev.sourceId]: status }))
              if (status !== 'active') {
                qc.invalidateQueries({ queryKey: ['sources'] })
                setTimeout(() => setActiveJobs(prev => {
                  const next = { ...prev }
                  delete next[ev.sourceId]
                  return next
                }), 3000)
              }
            } catch { /* malformed SSE line */ }
          }
        }
      } catch (e) {
        if ((e as any).name !== 'AbortError') setTimeout(connect, 3000)
      }
    }

    connect()
    return () => controller.abort()
  }, [qc])

  const { data, isLoading } = useQuery({
    queryKey: ['sources', page, perPage],
    queryFn: () => sourcesApi.list({ page, per_page: perPage }),
    placeholderData: (prev: any) => prev,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sources'] })

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => sourcesApi.update(id, { enabled }),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) => sourcesApi.remove(id),
    onSuccess: () => { invalidate(); toast.success('Source removed') },
  })

  const fetchOne = useMutation({
    mutationFn: (id: string) => sourcesApi.fetch(id),
    onSuccess: () => toast.success('Fetch job queued'),
  })

  const fetchAll = useMutation({
    mutationFn: sourcesApi.fetchAll,
    onSuccess: (d) => toast.success(`${d.queued} sources queued for fetch`),
  })

  const sources    = data?.items ?? []
  const totalPages = data?.pages ?? 1

  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
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
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload />Import
          </Button>
          <Button onClick={() => setOpen(true)}><Plus />Add Source</Button>
        </div>
      </div>

      <AddSourceDialog open={open} onClose={() => setOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      {editTarget && <EditSourceDialog source={editTarget} onClose={() => setEditTarget(null)} />}

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
        <>
          <div className="grid gap-3">
            {sources.map((src: any) => (
              <Card key={src.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary shrink-0">
                      <Rss className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{src.name}</p>
                        <Badge variant="outline" className="text-xs">{src.type}</Badge>
                        {src.interval && (
                          <Badge variant="secondary" className="text-xs">{src.interval}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-sm">{src.endpoint}</p>
                      <p className="text-xs text-muted-foreground">
                        {src.lastFetch
                          ? `Fetched ${formatDistanceToNow(new Date(src.lastFetch), { addSuffix: true })}`
                          : 'Never fetched'}
                        {' · '}{src._count?.posts ?? 0} posts
                        {(src.fetchCount > 0 || src.errorCount > 0) && (
                          <> · <span className="text-emerald-500">{src.fetchCount} ok</span> / <span className="text-red-400">{src.errorCount} err</span></>
                        )}
                      </p>
                      {src.fetchStatus === 'ERROR' && src.lastError && (
                        <p className="text-xs text-red-400 truncate max-w-sm mt-0.5">{src.lastError}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={src.fetchStatus === 'OK' ? 'success' : src.fetchStatus === 'ERROR' ? 'destructive' : 'secondary'}>
                      {src.fetchStatus}
                    </Badge>
                    <Switch
                      checked={src.enabled}
                      onCheckedChange={(enabled) => toggle.mutate({ id: src.id, enabled })}
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditTarget(src)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline"
                      onClick={() => fetchOne.mutate(src.id)}
                      disabled={fetchOne.isPending || activeJobs[src.id] === 'active'}>
                      {(fetchOne.isPending || activeJobs[src.id] === 'active')
                        ? <Loader2 className="animate-spin" />
                        : activeJobs[src.id] === 'completed'
                        ? <CheckCircle className="text-emerald-400" />
                        : activeJobs[src.id] === 'failed'
                        ? <XCircle className="text-red-400" />
                        : <Zap />}
                      {activeJobs[src.id] === 'active' ? 'Fetching…' : 'Fetch'}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove.mutate(src.id)}
                      className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums px-2">
                  {page} / {totalPages}
                </span>
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setPage(1) }}
                className="h-8 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none">
                {[10, 20, 50].map(n => <option key={n} value={n}>{n} / page</option>)}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  )
}
