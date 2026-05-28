import { useState, useEffect, useMemo, KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Save, Database, ListTree, Languages, ArrowRight, Loader2, X,
  Tag, Clock, Share2, Sparkles, ChevronDown, Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { pipelinesApi, sitesApi, sourcesApi, socialApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// ─── Types & constants ────────────────────────────────────────────────────────

interface CategoryMapping {
  sourceId: string
  sourceCategory: string
  destCategoryId: number | null
  destCategoryName: string | null
}

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
  postLimit: number
  aiPrompt: string | null
  socialAccountId: string | null
  socialTemplate: string | null
  languageSiteMapping: Record<string, string[]> | null
  categoryMappings: CategoryMapping[] | null
}

const LANGUAGE_OPTIONS = [
  { value: 'sq', label: 'Albanian (sq)' },
  { value: 'en', label: 'English (en)' },
  { value: 'de', label: 'German (de)' },
  { value: 'fr', label: 'French (fr)' },
  { value: 'it', label: 'Italian (it)' },
  { value: 'es', label: 'Spanish (es)' },
]

const SCHEDULE_PRESETS = [
  { label: 'Hourly',        value: '0 * * * *' },
  { label: 'Every 6h',     value: '0 */6 * * *' },
  { label: 'Daily 8am',    value: '0 8 * * *' },
  { label: 'Daily 6pm',    value: '0 18 * * *' },
  { label: 'Weekdays 8am', value: '0 8 * * 1-5' },
]

const SOCIAL_TEMPLATES = [
  { value: 'link_post',     label: 'Link post' },
  { value: 'photo_comment', label: 'Photo + comment' },
  { value: 'photo_only',    label: 'Photo only' },
  { value: 'text_link',     label: 'Text + link' },
  { value: 'image_overlay', label: 'Image overlay' },
]

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
  postLimit: 50,
  aiPrompt: null,
  socialAccountId: null,
  socialTemplate: null,
  languageSiteMapping: null,
  categoryMappings: null,
})

// ─── Form card wrapper ────────────────────────────────────────────────────────

function FormCard({ icon: Icon, title, children }: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card w-full">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-secondary/20">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="px-4 py-4 space-y-4 min-w-0">
        {children}
      </div>
    </div>
  )
}

// ─── Tag input ────────────────────────────────────────────────────────────────

function TagInput({ values, onChange, placeholder }: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const val = input.trim()
    if (!val || values.includes(val)) return
    onChange([...values, val])
    setInput('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
    if (e.key === 'Backspace' && !input && values.length) onChange(values.slice(0, -1))
  }
  return (
    <div className="flex flex-wrap gap-1.5 min-h-[38px] rounded-md border border-border bg-secondary px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
      {values.map(v => (
        <span key={v} className="flex items-center gap-1 rounded bg-primary/15 text-primary text-xs px-1.5 py-0.5">
          {v}
          <button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="hover:text-destructive">
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={values.length ? '' : placeholder}
        className="flex-1 min-w-[80px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}

// ─── Source accordion (per-source category mapping) ───────────────────────────

function SourceAccordion({
  sourceId, sourceName, destCategories, mappings, onToggle, onDestChange,
}: {
  sourceId: string
  sourceName: string
  destCategories: Array<{ id: number; name: string; siteId: string; siteName: string }>
  mappings: CategoryMapping[]
  onToggle: (sourceId: string, cat: string, checked: boolean) => void
  onDestChange: (sourceId: string, cat: string, destValue: string | null) => void
}) {
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['source-categories', sourceId],
    queryFn: () => sourcesApi.categories(sourceId),
  })

  const sourceMappings = mappings.filter(m => m.sourceId === sourceId)
  const selectedCats = new Set(sourceMappings.map(m => m.sourceCategory))

  // Auto-open when the source already has selections (e.g. on edit)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (selectedCats.size > 0) setOpen(true)
  }, [selectedCats.size > 0])

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Accordion header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
      >
        <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 text-sm font-medium truncate">{sourceName}</span>
        {selectedCats.size > 0 && (
          <span className="shrink-0 text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            {selectedCats.size} selected
          </span>
        )}
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
        {!isLoading && (categories as string[]).length > 0 && (
          <span className="text-xs text-muted-foreground shrink-0">
            {(categories as string[]).length} categories
          </span>
        )}
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Accordion body */}
      {open && (
        <>
          {!isLoading && (categories as string[]).length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground italic">No categories found for this source</p>
          )}
          {!isLoading && (categories as string[]).length > 0 && (
            <div className="divide-y divide-border/40">
              {(categories as string[]).map(cat => {
                const isSelected = selectedCats.has(cat)
                const mapping = sourceMappings.find(m => m.sourceCategory === cat)
                const currentDest = mapping?.destCategoryId != null
                  ? `${mapping.destCategoryId}@@${mapping.destCategoryName ?? ''}`
                  : ''
                return (
                  <label
                    key={cat}
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                      isSelected ? 'bg-primary/5' : 'hover:bg-secondary/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={e => onToggle(sourceId, cat, e.target.checked)}
                      className="rounded shrink-0"
                    />
                    <span className={`flex-1 text-sm font-mono truncate ${
                      isSelected ? 'text-foreground' : 'text-muted-foreground'
                    }`}>
                      {cat}
                    </span>
                    {isSelected && (
                      <>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <select
                          value={currentDest}
                          onChange={e => onDestChange(sourceId, cat, e.target.value || null)}
                          onClick={e => e.stopPropagation()}
                          className="h-8 w-48 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer shrink-0"
                        >
                          <option value="">Pass as-is</option>
                          {destCategories.map(dc => (
                            <option key={`${dc.id}@@${dc.siteId}`} value={`${dc.id}@@${dc.name}`}>
                              {dc.name}{destCategories.filter(d => d.name === dc.name).length > 1
                                ? ` (${dc.siteName})` : ''}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </label>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Pipeline editor page ─────────────────────────────────────────────────────

export function PipelineEditor() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEditing = !!id

  const { data: allPipelines = [] } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list })
  const { data: sites = [] } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })
  const { data: sourcesData } = useQuery({ queryKey: ['sources', 'all'], queryFn: () => sourcesApi.list({ per_page: 100 }) })
  const { data: socialAccounts = [] } = useQuery({ queryKey: ['social-accounts'], queryFn: socialApi.accounts })
  const sources: any[] = (sourcesData as any)?.items ?? []

  const existingPipeline = isEditing
    ? (allPipelines as Pipeline[]).find(p => p.id === id) ?? null
    : null

  const [form, setForm] = useState<Omit<Pipeline, 'id'>>(emptyForm())
  const [categoryMappings, setCategoryMappings] = useState<CategoryMapping[]>([])
  const [initialized, setInitialized] = useState(!isEditing)

  useEffect(() => {
    if (!initialized && existingPipeline) {
      setForm({ ...existingPipeline })
      setCategoryMappings(existingPipeline.categoryMappings ?? [])
      setInitialized(true)
    }
  }, [existingPipeline, initialized])

  const { data: siteCatsBySite = {} as Record<string, Array<{ id: number; name: string }>> } = useQuery({
    queryKey: ['site-categories-for-pipeline', form.siteIds],
    queryFn: async () => {
      const results: Record<string, Array<{ id: number; name: string; slug: string }>> = {}
      for (const sid of form.siteIds) {
        try { results[sid] = await sitesApi.categories(sid) } catch { results[sid] = [] }
      }
      return results
    },
    enabled: form.siteIds.length > 0,
  })

  const allDestCategories = useMemo(() => {
    const seen = new Set<string>()
    const items: Array<{ id: number; name: string; siteId: string; siteName: string }> = []
    for (const sid of form.siteIds) {
      const site = (sites as any[]).find(s => s.id === sid)
      const cats = (siteCatsBySite as any)[sid] ?? []
      for (const c of cats) {
        const key = `${c.name}@@${sid}`
        if (seen.has(key)) continue
        seen.add(key)
        items.push({ ...c, siteId: sid, siteName: site?.name ?? '' })
      }
    }
    return items
  }, [siteCatsBySite, form.siteIds, sites])

  // ── Mutations ──
  const create = useMutation({
    mutationFn: pipelinesApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] })
      toast.success('Pipeline created')
      navigate('/pipelines')
    },
  })
  const update = useMutation({
    mutationFn: ({ id: pid, ...d }: any) => pipelinesApi.update(pid, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] })
      toast.success('Pipeline saved')
      navigate('/pipelines')
    },
  })

  const handleSave = () => {
    const data = { ...form, categoryMappings: categoryMappings.length ? categoryMappings : null }
    if (isEditing) update.mutate({ id, ...data })
    else create.mutate(data)
  }

  // ── Form helpers ──
  const set = <K extends keyof Omit<Pipeline, 'id'>>(key: K, value: Omit<Pipeline, 'id'>[K]) =>
    setForm(p => ({ ...p, [key]: value }))

  const toggleSite = (sid: string) =>
    setForm(p => ({
      ...p,
      siteIds: p.siteIds.includes(sid) ? p.siteIds.filter(s => s !== sid) : [...p.siteIds, sid],
    }))

  const toggleSource = (sid: string) => {
    setForm(p => {
      const current = p.sourceFilter ?? []
      const isRemoving = current.includes(sid)
      const next = isRemoving ? current.filter(s => s !== sid) : [...current, sid]
      if (isRemoving) setCategoryMappings(prev => prev.filter(m => m.sourceId !== sid))
      return { ...p, sourceFilter: next.length ? next : null }
    })
  }

  const toggleCategorySelection = (sourceId: string, cat: string, checked: boolean) => {
    setCategoryMappings(prev => {
      if (checked) {
        if (prev.some(m => m.sourceId === sourceId && m.sourceCategory === cat)) return prev
        return [...prev, { sourceId, sourceCategory: cat, destCategoryId: null, destCategoryName: null }]
      }
      return prev.filter(m => !(m.sourceId === sourceId && m.sourceCategory === cat))
    })
  }

  const updateCategoryDest = (sourceId: string, cat: string, destValue: string | null) => {
    setCategoryMappings(prev => prev.map(m => {
      if (m.sourceId !== sourceId || m.sourceCategory !== cat) return m
      if (!destValue) return { ...m, destCategoryId: null, destCategoryName: null }
      const [idStr, name] = destValue.split('@@')
      return { ...m, destCategoryId: Number(idStr), destCategoryName: name || null }
    }))
  }

  const langMapping = form.languageSiteMapping ?? {}

  const addLangMapping = (code: string) => {
    if (!code || langMapping[code]) return
    setForm(p => ({ ...p, languageSiteMapping: { ...(p.languageSiteMapping ?? {}), [code]: [...p.siteIds] } }))
  }

  const setLangSites = (code: string, siteId: string, add: boolean) => {
    const current = langMapping[code] ?? []
    setForm(p => ({
      ...p,
      languageSiteMapping: {
        ...(p.languageSiteMapping ?? {}),
        [code]: add ? [...current, siteId] : current.filter(s => s !== siteId),
      },
    }))
  }

  const removeLangMapping = (code: string) => {
    const next = { ...langMapping }
    delete next[code]
    setForm(p => ({ ...p, languageSiteMapping: Object.keys(next).length ? next : null }))
  }

  const selectedSourceIds = form.sourceFilter ?? []
  const unusedLanguages = LANGUAGE_OPTIONS.filter(l => !langMapping[l.value])
  const isSaving = create.isPending || update.isPending
  const canSave = !!form.name.trim() && form.siteIds.length > 0

  if (isEditing && !initialized) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading pipeline…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Sticky top bar ── */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b border-border bg-background z-10">
        <Button
          variant="ghost" size="sm"
          onClick={() => navigate('/pipelines')}
          className="gap-1.5 text-muted-foreground shrink-0"
        >
          <ArrowLeft className="h-4 w-4" /> Pipelines
        </Button>
        <div className="h-4 w-px bg-border shrink-0" />
        <Input
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="Pipeline name…"
          className="w-64 h-8 text-sm font-medium"
        />
        <div className="ml-auto flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-2 cursor-pointer">
            <Switch checked={form.enabled} onCheckedChange={v => set('enabled', v)} />
            <span className="text-sm text-muted-foreground">Enabled</span>
          </label>
          <div className="h-4 w-px bg-border" />
          <Button variant="outline" size="sm" onClick={() => navigate('/pipelines')}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving
              ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              : <Save className="h-4 w-4 mr-1.5" />}
            {!form.name.trim() ? 'Name required' : !form.siteIds.length ? 'Select a site' : 'Save pipeline'}
          </Button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto bg-secondary/10">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

          {/* ── 1. Basic settings ── */}
          <FormCard icon={Settings2} title="Basic Settings">
            {/* Target sites */}
            <div className="space-y-1.5">
              <Label>Target sites <span className="text-muted-foreground font-normal text-xs">— where posts are published</span></Label>
              <div className="border border-border rounded-lg divide-y divide-border/50">
                {(sites as any[]).map((site: any) => (
                  <label key={site.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={form.siteIds.includes(site.id)}
                      onChange={() => toggleSite(site.id)}
                      className="rounded"
                    />
                    <span className="text-sm">{site.name}</span>
                  </label>
                ))}
                {!(sites as any[]).length && (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No sites configured yet.</p>
                )}
              </div>
            </div>

            {/* Post status */}
            <div className="space-y-1.5">
              <Label>Post status</Label>
              <div className="flex gap-2">
                {(['publish', 'draft'] as const).map(s => (
                  <button key={s} type="button"
                    onClick={() => set('defaultStatus', s)}
                    className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
                      form.defaultStatus === s
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40'
                    }`}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto-publish */}
            <label className="flex items-start gap-3 cursor-pointer">
              <Switch checked={form.autoPublish} onCheckedChange={v => set('autoPublish', v)} className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Auto-publish on scheduled run</p>
                <p className="text-xs text-muted-foreground mt-0.5">Manual "Run now" always works regardless of this setting.</p>
              </div>
            </label>
          </FormCard>

          {/* ── 2. Sources & category mapping ── */}
          <FormCard icon={Database} title="Sources & Category Mapping">
            {/* Source picker */}
            <div className="space-y-1.5">
              <Label>
                Sources
                <span className="text-muted-foreground font-normal text-xs ml-1.5">— leave all unchecked to include every source</span>
              </Label>
              <div className="border border-border rounded-lg divide-y divide-border/50 max-h-52 overflow-y-auto">
                {sources.map((s: any) => (
                  <label key={s.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedSourceIds.includes(s.id)}
                      onChange={() => toggleSource(s.id)}
                      className="rounded"
                    />
                    <span className="text-sm">{s.name}</span>
                  </label>
                ))}
                {!sources.length && (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No sources yet.</p>
                )}
              </div>
            </div>

            {/* Per-source accordions */}
            {selectedSourceIds.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
                    Category mapping
                    <span className="font-normal text-xs text-muted-foreground">— pick which categories to include and where to map them</span>
                  </Label>
                  {!form.siteIds.length && (
                    <span className="text-xs text-amber-500 shrink-0">Select target sites to enable</span>
                  )}
                </div>

                <div className="space-y-2">
                  {selectedSourceIds.map(sid => {
                    const src = sources.find((s: any) => s.id === sid)
                    if (!src) return null
                    return (
                      <SourceAccordion
                        key={sid}
                        sourceId={sid}
                        sourceName={src.name}
                        destCategories={allDestCategories}
                        mappings={categoryMappings}
                        onToggle={toggleCategorySelection}
                        onDestChange={updateCategoryDest}
                      />
                    )
                  })}
                </div>

                {categoryMappings.length > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    {categoryMappings.length} categor{categoryMappings.length !== 1 ? 'ies' : 'y'} selected — posts not matching any selected category are skipped.
                  </p>
                )}
              </div>
            )}
          </FormCard>

          {/* ── 3. Filters ── */}
          <FormCard icon={Tag} title="Filters">
            <div className="space-y-1.5">
              <Label>Category filter <span className="text-muted-foreground font-normal text-xs">(Enter or comma to add)</span></Label>
              <TagInput
                values={form.categoryFilter}
                onChange={v => set('categoryFilter', v)}
                placeholder="e.g. sport, tech, politics…"
              />
              <p className="text-xs text-muted-foreground">Only posts tagged with at least one of these categories will be processed.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Min quality score <span className="text-muted-foreground font-normal text-xs">(0 = no filter)</span></Label>
                <Input
                  type="number" min={0} max={100}
                  value={form.qualityMin}
                  onChange={e => set('qualityMin', Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Fallback category <span className="text-muted-foreground font-normal text-xs">(when no mapping matches)</span></Label>
                <Input
                  value={form.targetCategory ?? ''}
                  onChange={e => set('targetCategory', e.target.value || null)}
                  placeholder="e.g. Lajme"
                />
              </div>
            </div>
          </FormCard>

          {/* ── 4. Publishing schedule ── */}
          <FormCard icon={Clock} title="Publishing Schedule">
            <div className="space-y-1.5">
              <Label>Schedule <span className="text-muted-foreground font-normal text-xs">(blank = manual only)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {SCHEDULE_PRESETS.map(p => (
                  <button key={p.value} type="button"
                    onClick={() => set('schedule', form.schedule === p.value ? null : p.value)}
                    className={`text-xs rounded-full border px-3 py-1 transition-colors ${
                      form.schedule === p.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <Input
                value={form.schedule ?? ''}
                placeholder="Custom cron, e.g. 0 8 * * *"
                onChange={e => set('schedule', e.target.value || null)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Publish window <span className="text-muted-foreground font-normal text-xs">(hours, 0 = all at once)</span></Label>
                <Input
                  type="number" min={0} max={168}
                  value={form.publishWindowHours}
                  onChange={e => set('publishWindowHours', Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max posts per run</Label>
                <Input
                  type="number" min={1} max={500}
                  value={form.postLimit}
                  onChange={e => set('postLimit', Math.max(1, Math.min(500, Number(e.target.value))))}
                />
              </div>
            </div>
          </FormCard>

          {/* ── 5. Translation & routing ── */}
          <FormCard icon={Languages} title="Translation & Routing">
            <div className="space-y-1.5">
              <Label>Translate content to</Label>
              <select
                value={form.translateTo ?? ''}
                onChange={e => set('translateTo', e.target.value || null)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">No translation</option>
                {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Language-based site routing</Label>
              <p className="text-xs text-muted-foreground">Route posts by detected language to specific sites.</p>
              {unusedLanguages.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {unusedLanguages.map(l => (
                    <button key={l.value} type="button" onClick={() => addLangMapping(l.value)}
                      className="text-xs rounded-full border border-dashed border-border px-2.5 py-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      + {l.label}
                    </button>
                  ))}
                </div>
              )}
              {Object.keys(langMapping).length > 0 && (
                <div className="space-y-2 border border-border rounded-lg p-3">
                  {Object.entries(langMapping).map(([code, siteIds]) => (
                    <div key={code} className="rounded-md bg-secondary/40 p-2.5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold">
                          {LANGUAGE_OPTIONS.find(l => l.value === code)?.label ?? code}
                        </span>
                        <button type="button" onClick={() => removeLangMapping(code)}
                          className="text-muted-foreground hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(sites as any[]).map((site: any) => (
                          <button key={site.id} type="button"
                            onClick={() => setLangSites(code, site.id, !siteIds.includes(site.id))}
                            className={`text-xs rounded px-2 py-0.5 border transition-colors ${
                              siteIds.includes(site.id)
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/40'
                            }`}>
                            {site.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FormCard>

          {/* ── 6. AI & Content ── */}
          <FormCard icon={Sparkles} title="AI & Content">
            <div className="space-y-1.5">
              <Label>AI rewrite instruction <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <textarea
                rows={4}
                placeholder="e.g. Rewrite as a concise 3-paragraph news article in formal Albanian"
                value={form.aiPrompt ?? ''}
                onChange={e => set('aiPrompt', e.target.value || null)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          </FormCard>

          {/* ── 7. Social sharing ── */}
          <FormCard icon={Share2} title="Social Sharing">
            <div className="space-y-1.5">
              <Label>Auto-share account <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <select
                value={form.socialAccountId ?? ''}
                onChange={e => setForm(p => ({
                  ...p,
                  socialAccountId: e.target.value || null,
                  socialTemplate: e.target.value ? (p.socialTemplate ?? 'link_post') : null,
                }))}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">No social sharing</option>
                {(socialAccounts as any[]).filter((a: any) => a.enabled).map((a: any) => (
                  <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>
                ))}
              </select>
            </div>

            {form.socialAccountId && (
              <div className="space-y-1.5">
                <Label>Post template</Label>
                <select
                  value={form.socialTemplate ?? 'link_post'}
                  onChange={e => set('socialTemplate', e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {SOCIAL_TEMPLATES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            )}
          </FormCard>

          {/* Bottom padding */}
          <div className="h-4" />
        </div>
      </div>
    </div>
  )
}
