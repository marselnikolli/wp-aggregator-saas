import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, RefreshCw, Rss, Zap, Loader2, Upload, FileUp, ChevronLeft, ChevronRight, CheckCircle, XCircle, Pencil, Search, Code2, Globe, Activity, ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { sourcesApi, sitesApi } from '@/lib/api'
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

const FIELD_MAP_LABELS = [
  { key: 'title',       label: 'Title',       placeholder: 'title' },
  { key: 'content',     label: 'Content',     placeholder: 'content or body' },
  { key: 'excerpt',     label: 'Excerpt',     placeholder: 'excerpt or summary' },
  { key: 'imageUrl',    label: 'Image URL',   placeholder: 'image or thumbnail.url' },
  { key: 'originalUrl', label: 'Article URL', placeholder: 'url or link' },
  { key: 'remoteId',    label: 'Remote ID',   placeholder: 'id' },
  { key: 'author',      label: 'Author',      placeholder: 'author or author.name' },
]

type CategoryMapping = { id: string; name: string; count?: number }
type FieldMapData    = Record<string, string>
interface CustomApiValue {
  categories:     CategoryMapping[]
  fieldMap:       FieldMapData
  paginationParam: string
}

const EMPTY_CUSTOM: CustomApiValue = { categories: [], fieldMap: {}, paginationParam: '' }

function CustomApiSection({
  endpoint,
  value,
  onChange,
}: {
  endpoint: string
  value:    CustomApiValue
  onChange: (v: CustomApiValue) => void
}) {
  const scan = useMutation({
    mutationFn: () => sourcesApi.scanCustom(endpoint),
    onSuccess: (data: any) => {
      onChange({
        categories:      data.categories ?? [],
        fieldMap:        data.suggestedFieldMap ?? {},
        paginationParam: value.paginationParam,
      })
      toast.success(`Found ${(data.categories ?? []).length} categories`)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Scan failed'),
  })

  function setCategory(index: number, name: string) {
    const next = [...value.categories]
    next[index] = { ...next[index], name }
    onChange({ ...value, categories: next })
  }

  function setField(key: string, path: string) {
    onChange({ ...value, fieldMap: { ...value.fieldMap, [key]: path } })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm"
          onClick={() => scan.mutate()} disabled={!endpoint.trim() || scan.isPending}>
          {scan.isPending ? <Loader2 className="animate-spin" /> : <Search />}
          {scan.isPending ? 'Scanning…' : 'Scan categories'}
        </Button>
        {value.categories.length > 0 && (
          <span className="text-xs text-muted-foreground">{value.categories.length} categories found</span>
        )}
      </div>

      {value.categories.length > 0 && (
        <div className="grid gap-1.5">
          <Label>Categories <span className="text-muted-foreground text-xs font-normal">(edit names as needed)</span></Label>
          <div className="rounded-md border border-border overflow-hidden max-h-48 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 text-xs text-muted-foreground w-12">ID</th>
                  <th className="text-left px-3 py-1.5 text-xs text-muted-foreground">Name</th>
                  <th className="text-right px-3 py-1.5 text-xs text-muted-foreground w-14">Posts</th>
                </tr>
              </thead>
              <tbody>
                {value.categories.map((cat, i) => (
                  <tr key={cat.id} className="border-t border-border">
                    <td className="px-3 py-1 text-muted-foreground font-mono text-xs">{cat.id}</td>
                    <td className="px-2 py-0.5">
                      <Input value={cat.name} onChange={e => setCategory(i, e.target.value)}
                        className="h-7 text-sm border-0 bg-transparent focus-visible:ring-1 px-1" />
                    </td>
                    <td className="px-3 py-1 text-right text-muted-foreground text-xs">{cat.count ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label>Field mapping <span className="text-muted-foreground text-xs font-normal">(dot-path into each item)</span></Label>
        <div className="grid gap-1.5">
          {FIELD_MAP_LABELS.map(({ key, label, placeholder }) => (
            <div key={key} className="grid grid-cols-[110px_1fr] items-center gap-2">
              <span className="text-sm text-muted-foreground text-right">{label}</span>
              <Input value={value.fieldMap[key] ?? ''} onChange={e => setField(key, e.target.value)}
                placeholder={placeholder} className="h-7 text-sm" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Pagination param <span className="text-muted-foreground text-xs font-normal">(leave blank for single-page)</span></Label>
        <Input value={value.paginationParam} placeholder="page or p"
          onChange={e => onChange({ ...value, paginationParam: e.target.value })}
          className="max-w-xs h-8 text-sm" />
      </div>
    </div>
  )
}

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

function SourceHealthDialog({ source, onClose }: { source: any; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['source-health', source.id],
    queryFn:  () => sourcesApi.health(source.id),
  })

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Health — {source.name}</DialogTitle></DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : data ? (
          <div className="space-y-4 py-2">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-secondary/60 p-3 text-center">
                <p className="text-2xl font-bold">
                  {data.successRate !== null ? `${data.successRate}%` : '—'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Success rate</p>
              </div>
              <div className="rounded-md bg-secondary/60 p-3 text-center">
                <p className="text-2xl font-bold">
                  {data.avgDuration !== null ? `${(data.avgDuration / 1000).toFixed(1)}s` : '—'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Avg duration</p>
              </div>
              <div className="rounded-md bg-secondary/60 p-3 text-center">
                <p className="text-2xl font-bold">{data.totalJobs}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total runs</p>
              </div>
            </div>

            {/* Sparkline of recent jobs */}
            {data.recentJobs?.length > 0 && (
              <div className="grid gap-1.5">
                <p className="text-xs text-muted-foreground font-medium">Recent runs (newest right)</p>
                <div className="flex gap-1 items-end h-10">
                  {[...(data.recentJobs as any[])].reverse().map((job: any) => (
                    <div key={job.id} title={`${job.status} · ${job.newPosts} new · ${job.error ?? ''}`}
                      className={`flex-1 rounded-sm min-h-[4px] ${job.status === 'OK' ? 'bg-emerald-500' : job.status === 'ERROR' ? 'bg-red-500' : 'bg-muted'}`}
                      style={{ height: job.duration ? `${Math.min(100, (job.duration / 10000) * 100)}%` : '20%' }} />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>oldest</span><span className="text-emerald-500">■ ok</span><span className="text-red-400">■ error</span><span>newest</span>
                </div>
              </div>
            )}

            {/* Recent errors */}
            {data.recentJobs?.some((j: any) => j.status === 'ERROR') && (
              <div className="grid gap-1.5">
                <p className="text-xs text-muted-foreground font-medium">Recent errors</p>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {(data.recentJobs as any[]).filter(j => j.status === 'ERROR').slice(0, 5).map((job: any) => (
                    <div key={job.id} className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2">
                      <p className="text-xs text-red-400 font-mono truncate">{job.error}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(job.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.totalJobs === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No fetch history yet.</p>
            )}
          </div>
        ) : null}
        <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  RSS:        'RSS Feed',
  WP_API:     'WP REST API',
  CUSTOM_API: 'Mediadesk CMS',
}

function buildMediadeskEndpoint(domain: string): string {
  let d = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!d.startsWith('www.')) d = 'www.' + d
  return `https://${d}/meshume.php?j=1&id={id}`
}

function AddSourceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: '', endpoint: '', domain: '', type: 'RSS' as 'RSS' | 'WP_API' | 'CUSTOM_API',
  })
  const [customApi, setCustomApi] = useState<CustomApiValue>(EMPTY_CUSTOM)

  function reset() {
    setForm({ name: '', endpoint: '', domain: '', type: 'RSS' })
    setCustomApi(EMPTY_CUSTOM)
  }

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = {
        name: form.name,
        endpoint: form.type === 'CUSTOM_API' ? buildMediadeskEndpoint(form.domain) : form.endpoint,
        type: form.type,
      }
      if (form.type === 'CUSTOM_API') {
        body.fieldMap          = customApi.fieldMap
        body.categoryMappings  = customApi.categories
        body.paginationParam   = customApi.paginationParam || null
      }
      return sourcesApi.create(body)
    },
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ['sources'] })
      if (d.warning) toast.warning(d.warning)
      else toast.success('Source added')
      reset()
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to add source'),
  })

  function handleDetect(result: { type: string; endpoint: string; name: string }) {
    setForm(p => ({
      ...p,
      endpoint: result.endpoint,
      type: result.type as 'RSS' | 'WP_API' | 'CUSTOM_API',
      name: p.name || result.name,
    }))
  }

  const isCustom = form.type === 'CUSTOM_API'
  const constructedEndpoint = isCustom && form.domain.trim() ? buildMediadeskEndpoint(form.domain) : form.endpoint

  return (
    <Dialog open={open} onOpenChange={() => { reset(); onClose() }}>
      <DialogContent className={isCustom ? 'max-w-xl max-h-[88vh] overflow-y-auto' : ''}>
        <DialogHeader><DialogTitle>Add Feed Source</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input placeholder="My News Source" value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            {isCustom ? (
              <>
                <Label>Domain</Label>
                <Input placeholder="oranews.tv" value={form.domain}
                  onChange={e => setForm(p => ({ ...p, domain: e.target.value, name: p.name || e.target.value.replace(/^www\./, '') }))} />
                <p className="text-xs text-muted-foreground">
                  Endpoint will be auto-built as:<br />
                  <code className="bg-secondary px-1 rounded break-all">{constructedEndpoint}</code>
                </p>
              </>
            ) : (
              <>
                <Label>Endpoint URL</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={form.type === 'WP_API' ? 'https://example.com/wp-json/wp/v2/posts?_embed' : 'https://example.com/feed'}
                    value={form.endpoint}
                    onChange={e => setForm(p => ({ ...p, endpoint: e.target.value }))} />
                  <DetectButton url={form.endpoint} onDetect={handleDetect} />
                </div>
              </>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {(['RSS', 'WP_API', 'CUSTOM_API'] as const).map(t => (
                <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))}
                  className={`flex-1 rounded-md border py-2 text-sm transition-colors ${form.type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border/80'}`}>
                  {SOURCE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          {isCustom && (
            <CustomApiSection endpoint={constructedEndpoint} value={customApi} onChange={setCustomApi} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Add Source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function domainFromEndpoint(endpoint: string): string {
  try {
    const host = new URL(endpoint).hostname.replace(/^www\./, '')
    return host
  } catch { return endpoint }
}

function EditSourceDialog({ source, onClose }: { source: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name:        source.name ?? '',
    endpoint:    source.endpoint ?? '',
    domain:      domainFromEndpoint(source.endpoint ?? ''),
    type:        source.type as 'RSS' | 'WP_API' | 'CUSTOM_API',
    interval:    source.interval ?? '',
    username:    source.username ?? '',
    password:    '',
    tags:         (source.tags ?? []) as string[],
    minDelaySec:  source.minDelaySec ?? 1,
    userAgent:    source.userAgent ?? '',
    proxyUrl:     source.proxyUrl ?? '',
  })
  const [tagInput, setTagInput] = useState('')
  const [showCatMap, setShowCatMap] = useState(false)
  // categoryMap: { siteId: { remoteCategory: localCategory } }
  const [categoryMap, setCategoryMap] = useState<Record<string, Record<string, string>>>(
    (source.categoryMap as Record<string, Record<string, string>>) ?? {}
  )
  const { data: sites = [] } = useQuery<any[]>({ queryKey: ['sites'], queryFn: sitesApi.list })
  const { data: remoteCategories = [] } = useQuery<string[]>({
    queryKey: ['source-categories', source.id],
    queryFn: () => sourcesApi.categories(source.id),
  })
  const [customApi, setCustomApi] = useState<CustomApiValue>({
    categories:      (source.categoryMappings as CategoryMapping[]) ?? [],
    fieldMap:        (source.fieldMap as FieldMapData) ?? {},
    paginationParam: source.paginationParam ?? '',
  })

  const update = useMutation({
    mutationFn: () => {
      const body: Record<string, any> = {
        name:        form.name,
        endpoint:    form.type === 'CUSTOM_API' ? buildMediadeskEndpoint(form.domain) : form.endpoint,
        type:        form.type,
        interval:    form.interval || null,
        username:    form.username || null,
        tags:         form.tags,
        minDelaySec:  form.minDelaySec,
        userAgent:    form.userAgent || null,
        proxyUrl:     form.proxyUrl || null,
        categoryMap:  Object.keys(categoryMap).length ? categoryMap : null,
      }
      if (form.password) body.password = form.password
      if (form.type === 'CUSTOM_API') {
        body.fieldMap         = customApi.fieldMap
        body.categoryMappings = customApi.categories
        body.paginationParam  = customApi.paginationParam || null
      }
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
      type: result.type as 'RSS' | 'WP_API' | 'CUSTOM_API',
      name: p.name || result.name,
    }))
  }

  const isCustom = form.type === 'CUSTOM_API'
  const constructedEndpoint = isCustom && form.domain.trim() ? buildMediadeskEndpoint(form.domain) : form.endpoint

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={isCustom ? 'max-w-xl max-h-[88vh] overflow-y-auto' : ''}>
        <DialogHeader><DialogTitle>Edit Source</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            {isCustom ? (
              <>
                <Label>Domain</Label>
                <Input placeholder="oranews.tv" value={form.domain}
                  onChange={e => setForm(p => ({ ...p, domain: e.target.value }))} />
                <p className="text-xs text-muted-foreground">
                  Endpoint: <code className="bg-secondary px-1 rounded break-all">{constructedEndpoint}</code>
                </p>
              </>
            ) : (
              <>
                <Label>Endpoint URL</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={form.type === 'WP_API' ? 'https://example.com/wp-json/wp/v2/posts?_embed' : 'https://example.com/feed'}
                    value={form.endpoint}
                    onChange={e => setForm(p => ({ ...p, endpoint: e.target.value }))} />
                  <DetectButton url={form.endpoint} onDetect={handleDetect} />
                </div>
              </>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <div className="flex gap-2">
              {(['RSS', 'WP_API', 'CUSTOM_API'] as const).map(t => (
                <button key={t} onClick={() => setForm(p => ({ ...p, type: t }))}
                  className={`flex-1 rounded-md border py-2 text-sm transition-colors ${form.type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border/80'}`}>
                  {SOURCE_TYPE_LABELS[t]}
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
          {!isCustom && (
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
          )}
          {isCustom && (
            <>
              <CustomApiSection endpoint={form.endpoint} value={customApi} onChange={setCustomApi} />
              <div className="grid gap-1.5">
                <Label className="text-xs">Rate Limit — Delay between requests (seconds)</Label>
                <Input
                  type="number" min={0} max={60} className="w-24 text-sm"
                  value={form.minDelaySec}
                  onChange={e => setForm(p => ({ ...p, minDelaySec: Number(e.target.value) }))}
                />
              </div>
              <div className="grid gap-2 rounded-md border border-border/60 p-3">
                <p className="text-xs font-medium text-muted-foreground">Cloudflare Bypass</p>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Custom User-Agent <span className="text-muted-foreground">(leave blank for default Chrome UA)</span></Label>
                  <Input className="text-xs font-mono" placeholder="Mozilla/5.0 …"
                    value={form.userAgent}
                    onChange={e => setForm(p => ({ ...p, userAgent: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Proxy URL <span className="text-muted-foreground">(optional, e.g. http://host:port)</span></Label>
                  <Input className="text-xs font-mono" placeholder="http://proxy:8080"
                    value={form.proxyUrl}
                    onChange={e => setForm(p => ({ ...p, proxyUrl: e.target.value }))} />
                </div>
              </div>
            </>
          )}
          <div className="grid gap-1.5">
            <Label className="text-xs">Source Tags</Label>
            <div className="flex gap-1.5">
              <Input
                placeholder="Add tag…"
                value={tagInput}
                className="text-xs h-8"
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  const t = tagInput.trim().toLowerCase()
                  if (t && !form.tags.includes(t)) setForm(p => ({ ...p, tags: [...p.tags, t] }))
                  setTagInput('')
                }}
              />
            </div>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {form.tags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                    {t}
                    <button onClick={() => setForm(p => ({ ...p, tags: p.tags.filter(x => x !== t) }))}
                      className="text-muted-foreground hover:text-foreground">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Category mapping — shown when there are known categories and sites */}
        {remoteCategories.length > 0 && sites.length > 0 && (
          <div className="rounded-md border border-border/60">
            <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowCatMap(v => !v)}>
              Category mapping (remote → local WP)
              {showCatMap ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showCatMap && (
              <div className="border-t border-border/60 p-3 space-y-3">
                <p className="text-xs text-muted-foreground">Map remote category names to local WP category names per target site. Leave blank to use the original name.</p>
                {(sites as any[]).map(site => (
                  <div key={site.id} className="space-y-1.5">
                    <p className="text-xs font-medium">{site.name}</p>
                    <div className="grid gap-1">
                      {remoteCategories.map(cat => (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-36 truncate shrink-0">{cat}</span>
                          <span className="text-xs text-muted-foreground">→</span>
                          <Input
                            className="h-6 text-xs"
                            placeholder={cat}
                            value={(categoryMap[site.id] ?? {})[cat] ?? ''}
                            onChange={e => {
                              const val = e.target.value
                              setCategoryMap(m => {
                                const siteMap = { ...(m[site.id] ?? {}) }
                                if (val) siteMap[cat] = val; else delete siteMap[cat]
                                return { ...m, [site.id]: siteMap }
                              })
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
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
  const [editTarget, setEditTarget]     = useState<any>(null)
  const [healthTarget, setHealthTarget] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [tagFilter, setTagFilter] = useState('')
  const [activeJobs, setActiveJobs] = useState<Record<string, 'active' | 'completed' | 'failed'>>({})
  const [fetchPct, setFetchPct] = useState<Record<string, number>>({})
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
                type: 'job:active' | 'job:completed' | 'job:failed' | 'job:progress'
                sourceId: string
                progress?: { pct: number; phase: string; current?: number; total?: number }
              }
              if (ev.type === 'job:progress') {
                setFetchPct(prev => ({ ...prev, [ev.sourceId]: ev.progress?.pct ?? 0 }))
              } else {
                const status = ev.type === 'job:active' ? 'active' : ev.type === 'job:completed' ? 'completed' : 'failed'
                setActiveJobs(prev => ({ ...prev, [ev.sourceId]: status }))
                if (ev.type === 'job:active') setFetchPct(prev => ({ ...prev, [ev.sourceId]: 0 }))
                if (status !== 'active') {
                  setFetchPct(prev => ({ ...prev, [ev.sourceId]: 100 }))
                  qc.invalidateQueries({ queryKey: ['sources'] })
                  setTimeout(() => {
                    setActiveJobs(prev => { const n = { ...prev }; delete n[ev.sourceId]; return n })
                    setFetchPct(prev => { const n = { ...prev }; delete n[ev.sourceId]; return n })
                  }, 3000)
                }
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
    queryKey: ['sources', page, perPage, tagFilter],
    queryFn: () => sourcesApi.list({ page, per_page: perPage, ...(tagFilter ? { tag: tagFilter } : {}) }),
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

  const dragId = useRef<string | null>(null)
  const reorder = useMutation({
    mutationFn: ({ id, beforeId, afterId }: { id: string; beforeId: string | null; afterId: string | null }) =>
      sourcesApi.reorder(id, beforeId, afterId),
    onSuccess: invalidate,
  })

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

      {tagFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtered by tag:</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
            {tagFilter}
            <button onClick={() => setTagFilter('')} className="text-muted-foreground hover:text-foreground">×</button>
          </span>
        </div>
      )}

      <AddSourceDialog open={open} onClose={() => setOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      {editTarget   && <EditSourceDialog source={editTarget} onClose={() => setEditTarget(null)} />}
      {healthTarget && <SourceHealthDialog source={healthTarget} onClose={() => setHealthTarget(null)} />}

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
            {sources.map((src: any, idx: number) => (
              <Card key={src.id}
                draggable
                onDragStart={() => { dragId.current = src.id }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => {
                  const from = dragId.current
                  if (!from || from === src.id) return
                  const beforeId = idx > 0 ? sources[idx - 1]?.id ?? null : null
                  const afterId = src.id
                  reorder.mutate({ id: from, beforeId, afterId })
                  dragId.current = null
                }}
                className="cursor-default">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0 cursor-grab active:cursor-grabbing" />
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary shrink-0">
                      {src.type === 'CUSTOM_API'
                        ? <Code2 className="h-4 w-4 text-muted-foreground" />
                        : src.type === 'WP_API'
                        ? <Globe className="h-4 w-4 text-muted-foreground" />
                        : <Rss className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{src.name}</p>
                        <Badge variant="outline" className="text-xs">{src.type}</Badge>
                        {src.interval && (
                          <Badge variant="secondary" className="text-xs">{src.interval}</Badge>
                        )}
                        {false && (
                          <Badge variant="secondary" className="text-xs">unused</Badge>
                        )}
                        {src.tags?.map((t: string) => (
                          <Badge key={t} variant="outline" className="text-xs cursor-pointer hover:bg-secondary"
                            onClick={() => setTagFilter(t)}>
                            {t}
                          </Badge>
                        ))}
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
                    {activeJobs[src.id] === 'active' && (
                      <div className="w-24 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${fetchPct[src.id] ?? 0}%` }}
                        />
                      </div>
                    )}
                    <Badge variant={src.fetchStatus === 'OK' ? 'success' : src.fetchStatus === 'ERROR' ? 'destructive' : 'secondary'}>
                      {src.fetchStatus}
                    </Badge>
                    <Switch
                      checked={src.enabled}
                      onCheckedChange={(enabled) => toggle.mutate({ id: src.id, enabled })}
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => setHealthTarget(src)} title="Health">
                      <Activity className="h-3.5 w-3.5" />
                    </Button>
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
