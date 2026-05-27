import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Play, Pencil, Trash2, Zap, CheckCircle, X, Languages, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { pipelinesApi, sitesApi, sourcesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const LANGUAGE_OPTIONS = [
  { value: '',   label: 'No translation' },
  { value: 'sq', label: 'Albanian (sq)' },
  { value: 'en', label: 'English (en)' },
  { value: 'de', label: 'German (de)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'it', label: 'Italian (it)' },
  { value: 'es', label: 'Spanish (es)' },
]

interface Pipeline {
  id: string
  name: string
  enabled: boolean
  qualityMin: number
  autoPublish: boolean
  siteIds: string[]
  defaultStatus: 'publish' | 'draft'
  schedule: string | null
  sourceFilter: string[] | null
  categoryFilter: string[]
  translateTo: string | null
  targetCategory: string | null
  publishWindowHours: number
  aiPrompt: string | null
}

const emptyForm = (): Omit<Pipeline, 'id'> => ({
  name: '',
  enabled: true,
  qualityMin: 0,
  autoPublish: false,
  siteIds: [],
  defaultStatus: 'publish',
  schedule: null,
  sourceFilter: null,
  categoryFilter: [],
  translateTo: null,
  targetCategory: null,
  publishWindowHours: 0,
  aiPrompt: null,
})

function PipelineForm({
  initial, sites, sources, onSave, onClose,
}: {
  initial: Omit<Pipeline, 'id'>
  sites: Array<{ id: string; name: string }>
  sources: Array<{ id: string; name: string }>
  onSave: (data: Omit<Pipeline, 'id'>) => void
  onClose: () => void
}) {
  const [form, setForm] = useState(initial)
  const [catInput, setCatInput] = useState('')

  const toggleSite = (id: string) =>
    setForm(p => ({
      ...p,
      siteIds: p.siteIds.includes(id) ? p.siteIds.filter(s => s !== id) : [...p.siteIds, id],
    }))

  const toggleSource = (id: string) =>
    setForm(p => {
      const current = p.sourceFilter ?? []
      const next = current.includes(id) ? current.filter(s => s !== id) : [...current, id]
      return { ...p, sourceFilter: next.length ? next : null }
    })

  const addCategory = () => {
    const v = catInput.trim()
    if (!v || form.categoryFilter.includes(v)) return
    setForm(p => ({ ...p, categoryFilter: [...p.categoryFilter, v] }))
    setCatInput('')
  }

  const removeCategory = (c: string) =>
    setForm(p => ({ ...p, categoryFilter: p.categoryFilter.filter(x => x !== c) }))

  return (
    <div className="grid gap-4 py-2 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid gap-1.5">
        <Label>Pipeline name</Label>
        <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Morning publish" />
      </div>

      <div className="grid gap-1.5">
        <Label>Minimum quality score <span className="text-muted-foreground text-xs">(0 = no filter)</span></Label>
        <Input type="number" min={0} max={100} value={form.qualityMin}
          onChange={e => setForm(p => ({ ...p, qualityMin: Number(e.target.value) }))} />
      </div>

      <div className="grid gap-1.5">
        <Label>Schedule <span className="text-muted-foreground text-xs">(cron, blank = manual)</span></Label>
        <Input value={form.schedule ?? ''} placeholder="0 8 * * *"
          onChange={e => setForm(p => ({ ...p, schedule: e.target.value || null }))} />
      </div>

      <div className="grid gap-1.5">
        <Label>Default post status</Label>
        <div className="flex gap-2">
          {(['publish', 'draft'] as const).map(s => (
            <button key={s} type="button"
              onClick={() => setForm(p => ({ ...p, defaultStatus: s }))}
              className={`flex-1 rounded-md border py-2 text-sm transition-colors ${form.defaultStatus === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border/80'}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Source filter <span className="text-muted-foreground text-xs">(blank = all sources)</span></Label>
        <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto border border-border rounded-md p-2">
          {sources.map(s => (
            <label key={s.id} className="flex items-center gap-2 cursor-pointer text-sm py-0.5">
              <input type="checkbox"
                checked={(form.sourceFilter ?? []).includes(s.id)}
                onChange={() => toggleSource(s.id)}
                className="rounded" />
              {s.name}
            </label>
          ))}
          {!sources.length && <p className="text-xs text-muted-foreground">No sources yet.</p>}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Category filter <span className="text-muted-foreground text-xs">(blank = all categories)</span></Label>
        <div className="flex gap-1.5">
          <Input value={catInput} placeholder="e.g. Politics"
            onChange={e => setCatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory() } }} />
          <Button type="button" variant="outline" size="sm" onClick={addCategory}>Add</Button>
        </div>
        {form.categoryFilter.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {form.categoryFilter.map(c => (
              <span key={c} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs">
                {c}
                <button type="button" onClick={() => removeCategory(c)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label>Translation</Label>
        <select value={form.translateTo ?? ''} onChange={e => setForm(p => ({ ...p, translateTo: e.target.value || null }))}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
          {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>

      <div className="grid gap-1.5">
        <Label>Target WP category <span className="text-muted-foreground text-xs">(slug or ID on destination site)</span></Label>
        <Input value={form.targetCategory ?? ''} placeholder="e.g. news or 42"
          onChange={e => setForm(p => ({ ...p, targetCategory: e.target.value || null }))} />
      </div>

      <div className="grid gap-1.5">
        <Label>Publish window <span className="text-muted-foreground text-xs">(hours, 0 = all at once)</span></Label>
        <Input type="number" min={0} max={168} value={form.publishWindowHours}
          onChange={e => setForm(p => ({ ...p, publishWindowHours: Number(e.target.value) }))} />
      </div>

      <div className="grid gap-1.5">
        <Label>AI rewrite instruction <span className="text-muted-foreground text-xs">(optional)</span></Label>
        <textarea
          rows={3}
          placeholder="e.g. Rewrite as a concise 3-paragraph news article in formal English"
          value={form.aiPrompt ?? ''}
          onChange={e => setForm(p => ({ ...p, aiPrompt: e.target.value || null }))}
          className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Target sites</Label>
        <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto border border-border rounded-md p-2">
          {sites.map(site => (
            <label key={site.id} className="flex items-center gap-2 cursor-pointer text-sm py-0.5">
              <input type="checkbox" checked={form.siteIds.includes(site.id)} onChange={() => toggleSite(site.id)}
                className="rounded" />
              {site.name}
            </label>
          ))}
          {!sites.length && <p className="text-xs text-muted-foreground">No sites configured yet.</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.autoPublish} onCheckedChange={v => setForm(p => ({ ...p, autoPublish: v }))} />
        <Label className="cursor-pointer">Auto-publish on run</Label>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.enabled} onCheckedChange={v => setForm(p => ({ ...p, enabled: v }))} />
        <Label className="cursor-pointer">Enabled</Label>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={!form.name.trim() || !form.siteIds.length}>Save pipeline</Button>
      </DialogFooter>
    </div>
  )
}

export function Pipelines() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<Pipeline | null>(null)

  const { data: pipelines = [], isLoading } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })
  const { data: sourcesData } = useQuery({ queryKey: ['sources', 'all'], queryFn: () => sourcesApi.list({ per_page: 100 }) })
  const sources = sourcesData?.items ?? []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pipelines'] })

  const create = useMutation({
    mutationFn: pipelinesApi.create,
    onSuccess: () => { invalidate(); setShowAdd(false); toast.success('Pipeline created') },
  })
  const update = useMutation({
    mutationFn: ({ id, ...d }: any) => pipelinesApi.update(id, d),
    onSuccess: () => { invalidate(); setEditTarget(null); toast.success('Pipeline updated') },
  })
  const remove = useMutation({
    mutationFn: pipelinesApi.remove,
    onSuccess: () => { invalidate(); toast.success('Pipeline removed') },
  })
  const run = useMutation({
    mutationFn: pipelinesApi.run,
    onSuccess: (data) => toast.success(`Pipeline run: ${data.queued} tasks queued`),
    onError: () => toast.error('Pipeline run failed'),
  })
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => pipelinesApi.update(id, { enabled }),
    onSuccess: invalidate,
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Pipelines</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Automated publish workflows</p>
        </div>
        <Button onClick={() => setShowAdd(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Pipeline
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !pipelines.length ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3 text-muted-foreground">
            <Zap className="h-10 w-10 opacity-20" />
            <p className="text-sm">No pipelines yet. Create one to automate publishing.</p>
            <Button size="sm" onClick={() => setShowAdd(true)}>Create your first pipeline</Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pipelines.map((p: Pipeline) => (
              <Card key={p.id} className={p.enabled ? '' : 'opacity-60'}>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div>
                    <CardTitle className="text-sm font-semibold">{p.name}</CardTitle>
                    {p.schedule && (
                      <p className="text-xs text-muted-foreground mt-0.5 font-mono">{p.schedule}</p>
                    )}
                  </div>
                  <Switch checked={p.enabled} onCheckedChange={enabled => toggle.mutate({ id: p.id, enabled })} />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Badge variant={p.defaultStatus === 'publish' ? 'success' : 'secondary'}>{p.defaultStatus}</Badge>
                    {p.autoPublish && <Badge variant="outline"><CheckCircle className="h-2.5 w-2.5 mr-1" />Auto</Badge>}
                    {p.qualityMin > 0 && <Badge variant="outline">Q≥{p.qualityMin}</Badge>}
                    <Badge variant="secondary">{p.siteIds.length} site{p.siteIds.length !== 1 ? 's' : ''}</Badge>
                    {p.sourceFilter?.length ? <Badge variant="outline">{p.sourceFilter.length} source{p.sourceFilter.length !== 1 ? 's' : ''}</Badge> : null}
                    {p.categoryFilter?.length ? (
                      <Badge variant="outline" className="font-mono">{p.categoryFilter.slice(0, 2).join(', ')}{p.categoryFilter.length > 2 ? `…` : ''}</Badge>
                    ) : null}
                    {p.translateTo && (
                      <Badge variant="outline" className="text-blue-400 border-blue-500/30">
                        <Languages className="h-2.5 w-2.5 mr-1" />
                        <ArrowRight className="h-2.5 w-2.5 mr-0.5" />{p.translateTo}
                      </Badge>
                    )}
                    {p.publishWindowHours > 0 && (
                      <Badge variant="outline">{p.publishWindowHours}h window</Badge>
                    )}
                    {p.aiPrompt && (
                      <Badge variant="outline" className="text-violet-400 border-violet-500/30">AI rewrite</Badge>
                    )}
                  </div>
                  {!p.schedule && (
                    <p className="text-xs text-muted-foreground">Manual trigger only</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1"
                      onClick={() => run.mutate(p.id)} disabled={run.isPending}>
                      <Play className="h-3 w-3 mr-1" /> Run now
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditTarget(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => remove.mutate(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Pipeline</DialogTitle></DialogHeader>
          <PipelineForm initial={emptyForm()} sites={sites} sources={sources} onSave={d => create.mutate(d)} onClose={() => setShowAdd(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={v => { if (!v) setEditTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Pipeline</DialogTitle></DialogHeader>
          {editTarget && (
            <PipelineForm
              initial={editTarget}
              sites={sites}
              sources={sources}
              onSave={d => update.mutate({ id: editTarget.id, ...d })}
              onClose={() => setEditTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
