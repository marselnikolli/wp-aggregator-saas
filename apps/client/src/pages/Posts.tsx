import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Trash2, FileText,
  Loader2, ExternalLink, ChevronLeft, ChevronRight,
  Pencil, Save, X, CheckSquare, Square, Keyboard, Sparkles, Share2, Columns3,
} from 'lucide-react'
import { diffWords } from 'diff'
import { formatDistanceToNow, format, sub } from 'date-fns'
import { toast } from 'sonner'
import { postsApi, sitesApi, sourcesApi, socialApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { RichTextEditor } from '@/components/RichTextEditor'

const PER_PAGE = [10, 25, 50, 100] as const

const SOCIAL_TEMPLATES = [
  { value: 'photo_comment', label: 'Photo + Comment' },
  { value: 'link_post',     label: 'Link Post'       },
  { value: 'photo_only',   label: 'Photo Only'       },
  { value: 'text_link',    label: 'Text + Link'      },
  { value: 'image_overlay',label: 'Image Overlay'    },
] as const

function SocialPostPreview({ post, template, caption }: { post: any; template: string; caption: string }) {
  const img = post?.imageUrl
  const title = post?.aiTitle ?? post?.title ?? ''
  const domain = post?.originalUrl ? new URL(post.originalUrl).hostname.replace('www.', '') : post?.source?.name ?? 'example.com'
  const platformName = 'SocialMedia'

  const card = 'rounded-xl border border-border bg-card shadow-sm overflow-hidden max-w-sm w-full'
  const textXs = 'text-xs text-muted-foreground'
  if (template === 'photo_comment') {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <div className="h-8 w-8 rounded-full bg-muted-foreground/20 shrink-0 flex items-center justify-center text-xs font-bold text-muted-foreground">{platformName[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-tight">{platformName}</p>
            <p className={textXs}>Just now</p>
          </div>
          <div className="text-muted-foreground">···</div>
        </div>
        {img ? (
          <img src={img} alt="" className="w-full aspect-[4/3] object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <div className="w-full aspect-[4/3] bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>
        )}
        <div className="px-3 py-2.5 space-y-1.5">
          <div className="flex gap-3 text-muted-foreground">
            <span>❤</span><span>💬</span><span>↗</span>
          </div>
          {caption && <p className="text-xs whitespace-pre-wrap line-clamp-3">{caption}</p>}
          <p className={textXs}>View 1 comment</p>
        </div>
      </div>
    )
  }

  if (template === 'link_post') {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="h-8 w-8 rounded-full bg-muted-foreground/20 shrink-0 flex items-center justify-center text-xs font-bold text-muted-foreground">{platformName[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-tight">{platformName}</p>
            <p className={textXs}>Just now</p>
          </div>
          <div className="text-muted-foreground">···</div>
        </div>
        {caption && <p className="px-3 pb-2 text-xs whitespace-pre-wrap line-clamp-2">{caption}</p>}
        <div className="border-t border-border">
          {img ? (
            <img src={img} alt="" className="w-full aspect-[16/9] object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <div className="w-full aspect-[16/9] bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>
          )}
          <div className="px-3 py-2 space-y-0.5 bg-muted/30">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{domain}</p>
            <p className="text-xs font-semibold leading-snug line-clamp-2">{title}</p>
            <p className={textXs}>Tap to read more</p>
          </div>
        </div>
        <div className="flex gap-3 px-3 py-2 border-t border-border text-muted-foreground">
          <span>❤</span><span>💬</span><span>↗</span>
        </div>
      </div>
    )
  }

  if (template === 'photo_only') {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <div className="h-8 w-8 rounded-full bg-muted-foreground/20 shrink-0 flex items-center justify-center text-xs font-bold text-muted-foreground">{platformName[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-tight">{platformName}</p>
            <p className={textXs}>Just now</p>
          </div>
          <div className="text-muted-foreground">···</div>
        </div>
        {img ? (
          <img src={img} alt="" className="w-full aspect-square object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <div className="w-full aspect-square bg-muted flex items-center justify-center text-muted-foreground text-xs">No image</div>
        )}
        <div className="px-3 py-2.5 space-y-1">
          <div className="flex gap-3 text-muted-foreground">
            <span>❤</span><span>💬</span><span>↗</span>
          </div>
          {caption && <p className="text-xs whitespace-pre-wrap line-clamp-2">{caption}</p>}
        </div>
      </div>
    )
  }

  if (template === 'text_link') {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="h-8 w-8 rounded-full bg-muted-foreground/20 shrink-0 flex items-center justify-center text-xs font-bold text-muted-foreground">{platformName[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-tight">{platformName}</p>
            <p className={textXs}>Just now</p>
          </div>
          <div className="text-muted-foreground">···</div>
        </div>
        <div className="px-3 pb-1 space-y-1">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          <p className="text-xs whitespace-pre-wrap line-clamp-3">{caption || 'No caption'}</p>
        </div>
        <div className="px-3 pb-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium px-3 py-1.5">{domain} ↗</div>
        </div>
        <div className="flex gap-3 px-3 py-2 border-t border-border text-muted-foreground">
          <span>❤</span><span>💬</span><span>↗</span>
        </div>
      </div>
    )
  }

  if (template === 'image_overlay') {
    return (
      <div className={card}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <div className="h-8 w-8 rounded-full bg-muted-foreground/20 shrink-0 flex items-center justify-center text-xs font-bold text-muted-foreground">{platformName[0]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-tight">{platformName}</p>
            <p className={textXs}>Just now</p>
          </div>
          <div className="text-muted-foreground">···</div>
        </div>
        <div className="relative w-full aspect-[4/3]">
          {img ? (
            <img src={img} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <div className="absolute inset-0 bg-muted" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 space-y-1">
            <p className="text-xs font-medium text-white/70 uppercase tracking-wide">{domain}</p>
            <p className="text-sm font-bold text-white leading-snug line-clamp-3">{title}</p>
            {caption && <p className="text-xs text-white/80 line-clamp-2">{caption}</p>}
          </div>
        </div>
        <div className="flex gap-3 px-3 py-2 text-muted-foreground">
          <span>❤</span><span>💬</span><span>↗</span>
        </div>
      </div>
    )
  }

  return null
}

function ShareDialog({ post, open, onClose }: { post: any; open: boolean; onClose: () => void }) {
  const [accountId,   setAccountId]   = useState('')
  const [template,    setTemplate]    = useState('link_post')
  const [scheduledAt, setScheduledAt] = useState('')
  const [caption,     setCaption]     = useState('')
  const [captionLoading, setCaptionLoading] = useState(false)
  const [result,      setResult]      = useState<{ ok: boolean; message: string } | null>(null)
  const [publishing,  setPublishing]  = useState(false)

  const { data: accounts } = useQuery({
    queryKey: ['social-accounts'],
    queryFn:  socialApi.accounts,
  })

  useEffect(() => {
    if (!accountId || !template || !post?.id) return
    let cancelled = false
    const t = setTimeout(async () => {
      setCaptionLoading(true)
      try {
        const res = await socialApi.previewCaption(post.id, accountId, template)
        if (!cancelled) setCaption(res.caption ?? '')
      } catch {
        if (!cancelled) setCaption('')
      } finally {
        if (!cancelled) setCaptionLoading(false)
      }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [accountId, template, post?.id])

  async function handlePublish() {
    if (!accountId) return
    setPublishing(true)
    setResult(null)
    try {
      await socialApi.publish({
        postId:      post.id,
        accountId,
        template,
        scheduledAt: scheduledAt || undefined,
      })
      setResult({ ok: true, message: scheduledAt ? 'Scheduled successfully' : 'Published successfully' })
    } catch (e: any) {
      setResult({ ok: false, message: e.response?.data?.error ?? 'Publish failed' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Share to Social</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">Sharing: <strong>{post?.title}</strong></p>

          <div className="grid gap-1.5">
            <Label className="text-xs">Account</Label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="h-9 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select account…</option>
              {(accounts ?? []).filter((a: any) => a.enabled).map((a: any) => (
                <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Template</Label>
            <select
              value={template}
              onChange={e => setTemplate(e.target.value)}
              className="h-9 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {SOCIAL_TEMPLATES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">
              Schedule <span className="text-muted-foreground">(optional — leave blank to post now)</span>
            </Label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {accountId && (
            <div className="grid gap-2">
              <Label className="text-xs flex items-center gap-1.5">
                Live preview
                {captionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </Label>
              <div className="flex justify-center">
                <SocialPostPreview post={post} template={template} caption={caption} />
              </div>
            </div>
          )}

          {result && (
            <p className={`text-sm ${result.ok ? 'text-emerald-400' : 'text-destructive'}`}>
              {result.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handlePublish} disabled={!accountId || publishing}>
            {publishing && <Loader2 className="animate-spin" />}
            {scheduledAt ? 'Schedule' : 'Share now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const DATE_PRESETS = [
  { label: 'All time',      days: 0  },
  { label: 'Today',         days: 1  },
  { label: 'Last 7 days',   days: 7  },
  { label: 'Last 30 days',  days: 30 },
  { label: 'Last 3 months', days: 90 },
]

const SHORTCUTS = [
  { key: 'j / k', desc: 'Navigate posts' },
  { key: 'e',     desc: 'Toggle edit'    },
  { key: 'Esc',   desc: 'Cancel / clear' },
]

function dateFromPreset(days: number) {
  if (!days) return ''
  return sub(new Date(), { days }).toISOString()
}

const WP_STATUS_OPTIONS = [
  { value: 'publish', label: 'Publish now' },
  { value: 'draft',   label: 'Save as draft' },
  { value: 'future',  label: 'Schedule' },
] as const

interface SiteTarget {
  siteId:           string
  wpStatus:         'publish' | 'draft' | 'future'
  scheduleAt:       string
  categoryOverride: string
  tagOverrides:     string
}

function PublishDialog({ post, open, onClose }: { post: any; open: boolean; onClose: () => void }) {
  const [targets,    setTargets]    = useState<Record<string, SiteTarget>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })
  const qc = useQueryClient()

  const toggle = (siteId: string, checked: boolean) => {
    if (checked) {
      setTargets(p => ({ ...p, [siteId]: { siteId, wpStatus: 'publish', scheduleAt: '', categoryOverride: '', tagOverrides: '' } }))
    } else {
      setTargets(p => { const n = { ...p }; delete n[siteId]; return n })
      if (expandedId === siteId) setExpandedId(null)
    }
  }

  const update = (siteId: string, field: keyof SiteTarget, value: string) =>
    setTargets(p => ({ ...p, [siteId]: { ...p[siteId], [field]: value } }))

  const selected = Object.values(targets)
  const canSubmit = selected.length > 0 && selected.every(t => t.wpStatus !== 'future' || !!t.scheduleAt)

  const publish = useMutation({
    mutationFn: () => postsApi.publish(post.id, selected.map(t => ({
      siteId:           t.siteId,
      wpStatus:         t.wpStatus,
      scheduledDate:    t.wpStatus === 'future' && t.scheduleAt ? new Date(t.scheduleAt).toISOString() : undefined,
      categoryOverride: t.categoryOverride || undefined,
      tagOverrides:     t.tagOverrides ? t.tagOverrides.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
    }))),
    onSuccess: (d) => {
      toast.success(`Queued for ${d.queued} site(s)`)
      qc.invalidateQueries({ queryKey: ['posts'] })
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Publish failed'),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Publish to Sites</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <p className="text-sm text-muted-foreground">Destination for: <strong>{post?.title}</strong></p>
          {sites?.map((site: any) => {
            const t = targets[site.id]
            const checked = !!t
            const expanded = expandedId === site.id
            return (
              <div key={site.id} className="rounded-md border border-border overflow-hidden">
                <label className="flex items-center gap-3 p-3 cursor-pointer hover:bg-secondary/50">
                  <Switch checked={checked} onCheckedChange={(c) => toggle(site.id, c)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{site.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{site.url}</p>
                  </div>
                  {checked && (
                    <button type="button" onClick={(e) => { e.preventDefault(); setExpandedId(expanded ? null : site.id) }}
                      className="text-xs text-muted-foreground hover:text-foreground px-1">
                      {expanded ? 'Hide' : 'Options'}
                    </button>
                  )}
                </label>
                {checked && expanded && (
                  <div className="border-t border-border bg-secondary/30 px-3 pb-3 pt-2 space-y-2.5">
                    <div>
                      <Label className="text-xs">Status</Label>
                      <div className="flex gap-1.5 mt-1">
                        {WP_STATUS_OPTIONS.map(opt => (
                          <button key={opt.value} type="button" onClick={() => update(site.id, 'wpStatus', opt.value)}
                            className={`flex-1 rounded border py-1 text-[11px] transition-colors ${t.wpStatus === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {t.wpStatus === 'future' && (
                      <div>
                        <Label className="text-xs">Schedule</Label>
                        <input type="datetime-local" value={t.scheduleAt} onChange={e => update(site.id, 'scheduleAt', e.target.value)}
                          className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring" />
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">Category override</Label>
                      <Input className="mt-1 h-8 text-xs" placeholder="e.g. Technology" value={t.categoryOverride}
                        onChange={e => update(site.id, 'categoryOverride', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Tag overrides <span className="text-muted-foreground">(comma-separated)</span></Label>
                      <Input className="mt-1 h-8 text-xs" placeholder="e.g. news, albania" value={t.tagOverrides}
                        onChange={e => update(site.id, 'tagOverrides', e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => publish.mutate()} disabled={!canSubmit || publish.isPending}>
            {publish.isPending && <Loader2 className="animate-spin" />}
            {`Publish to ${selected.length} site${selected.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ContentDiffView({ original, rewritten }: { original: string; rewritten: string }) {
  const diff = useMemo(() => diffWords(original, rewritten), [original, rewritten])
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-border text-xs">
        <div className="p-3 space-y-1.5">
          <p className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide mb-2">Original</p>
          <div className="leading-relaxed text-foreground/80">
            {diff.filter(p => !p.added).map((p, i) =>
              p.removed
                ? <span key={i} className="bg-red-500/20 text-red-400 line-through rounded px-0.5">{p.value}</span>
                : <span key={i}>{p.value}</span>
            )}
          </div>
        </div>
        <div className="p-3 space-y-1.5">
          <p className="font-medium text-muted-foreground text-[11px] uppercase tracking-wide mb-2">AI Enhanced</p>
          <div className="leading-relaxed text-foreground/80">
            {diff.filter(p => !p.removed).map((p, i) =>
              p.added
                ? <span key={i} className="bg-emerald-500/20 text-emerald-400 rounded px-0.5">{p.value}</span>
                : <span key={i}>{p.value}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Keyboard Shortcuts</DialogTitle></DialogHeader>
        <div className="space-y-2.5 py-2">
          {SHORTCUTS.map(s => (
            <div key={s.key} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.desc}</span>
              <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 text-xs font-mono">{s.key}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function Posts() {
  const [page,          setPage]          = useState(1)
  const [perPage,       setPerPage]       = useState(25)
  const [sourceId,      setSourceId]      = useState('')
  const [category,      setCategory]      = useState('')
  const [dateDays,      setDateDays]      = useState(0)
  const [searchInput,   setSearchInput]   = useState('')
  const [search,        setSearch]        = useState('')
  const [language,      setLanguage]      = useState('')
  const [selected,      setSelected]      = useState<any>(null)
  const [publishTarget, setPublishTarget] = useState<any>(null)
  const [shareTarget,   setShareTarget]   = useState<any>(null)
  const [checkedIds,    setCheckedIds]    = useState<Set<string>>(new Set())
  const [editMode,      setEditMode]      = useState(false)
  const [draft,         setDraft]         = useState({ title: '', excerpt: '', content: '' })
  const [catInput,      setCatInput]      = useState('')
  const [localCats,     setLocalCats]     = useState<string[] | null>(null)
  const [shortcutHelp,  setShortcutHelp]  = useState(false)
  const [bulkSiteId,    setBulkSiteId]    = useState('')
  const [bulkDialog,    setBulkDialog]    = useState(false)
  const [diffView,      setDiffView]      = useState(false)
  const qc = useQueryClient()

  useEffect(() => { setPage(1); setCategory('') }, [sourceId])
  useEffect(() => { setPage(1) }, [category, dateDays, perPage, search, language])

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [searchInput])
  useEffect(() => { setCheckedIds(new Set()) }, [page])
  useEffect(() => { setEditMode(false); setLocalCats(null); setCatInput('') }, [selected?.id])

  const dateFrom = useMemo(() => dateFromPreset(dateDays), [dateDays])

  const { data: languagesData } = useQuery({
    queryKey: ['post-languages'],
    queryFn:  postsApi.languages,
    staleTime: 5 * 60_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['posts', page, perPage, sourceId, category, dateDays, search, language],
    queryFn: () => postsApi.list({
      page,
      per_page: perPage,
      ...(sourceId && { sourceId }),
      ...(category && { category }),
      ...(dateFrom && { dateFrom }),
      ...(search   && { search }),
      ...(language && { language }),
    }),
    placeholderData: (prev: any) => prev,
    refetchInterval: 15_000,
  })

  const { data: sourcesData } = useQuery({
    queryKey: ['sources', 'all'],
    queryFn:  () => sourcesApi.list({ per_page: 100 }),
  })

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn:  sitesApi.list,
  })

  const { data: categories } = useQuery({
    queryKey: ['source-categories', sourceId],
    queryFn:  () => sourcesApi.categories(sourceId),
    enabled:  !!sourceId,
  })

  const posts      = data?.items ?? []
  const totalPages = data?.pages ?? 1
  const total      = data?.total ?? 0

  useEffect(() => {
    if (!posts.length) { setSelected(null); return }
    setSelected((prev: any) => posts.find((p: any) => p.id === prev?.id) ?? posts[0])
  }, [data])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['posts'] })

  const remove = useMutation({
    mutationFn: (id: string) => postsApi.remove(id),
    onSuccess: () => { invalidate(); toast.success('Deleted') },
  })
  const updatePost = useMutation({
    mutationFn: (fields: { title?: string; excerpt?: string; content?: string }) =>
      postsApi.update(selected.id, fields),
    onSuccess: (updated: any) => {
      invalidate()
      setSelected((prev: any) => ({ ...prev, ...updated }))
      setEditMode(false)
      toast.success('Post updated')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Update failed'),
  })

  const bulkRemove = useMutation({
    mutationFn: () => Promise.allSettled([...checkedIds].map(id => postsApi.remove(id))),
    onSuccess: (results) => {
      const ok = results.filter(r => r.status === 'fulfilled').length
      const err = results.filter(r => r.status === 'rejected').length
      err ? toast.error(`${ok} deleted, ${err} failed`) : toast.success(`${ok} posts deleted`)
      invalidate(); setCheckedIds(new Set())
    },
  })

  const bulkPublish = useMutation({
    mutationFn: () => postsApi.bulkPublish({ postIds: [...checkedIds], siteId: bulkSiteId }),
    onSuccess: (d: any) => {
      toast.success(`Queued ${d.queued} publish tasks`)
      invalidate(); setCheckedIds(new Set()); setBulkDialog(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Bulk publish failed'),
  })

  function toggleCheck(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setCheckedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setCheckedIds(
      checkedIds.size === posts.length && posts.length > 0
        ? new Set()
        : new Set(posts.map((p: any) => p.id))
    )
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return
      const idx = posts.findIndex((p: any) => p.id === selected?.id)
      switch (e.key) {
        case 'j': if (idx < posts.length - 1) setSelected(posts[idx + 1]); break
        case 'k': if (idx > 0) setSelected(posts[idx - 1]); break
        case 'e':
          if (selected) {
            if (editMode) { setEditMode(false) }
            else { setDraft({ title: selected.title ?? '', excerpt: selected.excerpt ?? '', content: selected.content ?? '' }); setEditMode(true) }
          }
          break
        case 'Escape':
          if (editMode) setEditMode(false)
          else if (checkedIds.size > 0) setCheckedIds(new Set())
          break
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [posts, selected, editMode, checkedIds])

  const allChecked  = posts.length > 0 && checkedIds.size === posts.length
  const someChecked = checkedIds.size > 0 && checkedIds.size < posts.length

  // Content is sanitized server-side by the cheerio pipeline before DB storage
  const rawHtml = selected?.content ?? ''
  const fallbackHtml = selected?.excerpt
    ? `<blockquote>${selected.excerpt.replace(/<[^>]+>/g, '')}</blockquote><p style="color:var(--muted-foreground);font-style:italic;font-size:0.75rem">Full content not available</p>`
    : '<p><em>No content available.</em></p>'
  const htmlContent = rawHtml || fallbackHtml

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="flex-[2] min-w-0 flex flex-col border-r border-border overflow-hidden">

        {/* Filters */}
        <div className="shrink-0 p-4 space-y-2 border-b border-border">
          <div className="flex items-center justify-between">
            <h1 className="font-semibold">Posts</h1>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{total} total</span>
              <button onClick={() => setShortcutHelp(true)} className="text-muted-foreground hover:text-foreground transition-colors">
                <Keyboard className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <Input
            placeholder="Search posts…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="flex gap-1.5">
            <select value={sourceId} onChange={e => setSourceId(e.target.value)}
              className="flex-1 min-w-0 h-8 rounded-md border border-border bg-secondary px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring truncate">
              <option value="">All sources</option>
              {sourcesData?.items?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={category} onChange={e => setCategory(e.target.value)} disabled={!sourceId}
              className="flex-1 min-w-0 h-8 rounded-md border border-border bg-secondary px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring truncate disabled:opacity-50">
              <option value="">{sourceId ? 'All categories' : 'Pick source first'}</option>
              {(categories ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={dateDays} onChange={e => setDateDays(Number(e.target.value))}
              className="flex-1 min-w-0 h-8 rounded-md border border-border bg-secondary px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring truncate">
              {DATE_PRESETS.map(p => <option key={p.days} value={p.days}>{p.label}</option>)}
            </select>
            {languagesData?.length > 0 && (
              <select value={language} onChange={e => { setLanguage(e.target.value); setPage(1) }}
                className="flex-1 min-w-0 h-8 rounded-md border border-border bg-secondary px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring truncate">
                <option value="">All langs</option>
                {languagesData.map((l: { code: string; count: number }) => (
                  <option key={l.code} value={l.code}>{l.code} ({l.count})</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Bulk action bar */}
        {checkedIds.size > 0 && (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-primary/5 border-b border-border">
            <span className="text-xs text-muted-foreground flex-1">{checkedIds.size} selected</span>
            <button onClick={() => setCheckedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground mr-1">Clear</button>
            <Button size="sm" className="h-7 text-xs" onClick={() => { setBulkSiteId(''); setBulkDialog(true) }}>
              <Upload className="h-3 w-3 mr-1" />Publish to…
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => bulkRemove.mutate()} disabled={bulkRemove.isPending}>
              {bulkRemove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}

        {/* Select-all header */}
        {posts.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border/50">
            <button onClick={toggleAll} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              {allChecked
                ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                : someChecked
                ? <CheckSquare className="h-3.5 w-3.5 opacity-50" />
                : <Square className="h-3.5 w-3.5" />}
              Select all
            </button>
          </div>
        )}

        {/* Post list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-3 space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}</div>
          ) : !posts.length ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground py-16">
              <FileText className="h-8 w-8 opacity-25" />
              <p className="text-sm">No posts</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {posts.map((post: any) => {
                const isChecked = checkedIds.has(post.id)
                return (
                  <div key={post.id} onClick={() => setSelected(post)}
                    className={cn('w-full text-left p-2.5 rounded-md transition-colors border cursor-pointer',
                      selected?.id === post.id ? 'bg-primary/10 border-primary/30' : 'border-transparent hover:bg-secondary')}>
                    <div className="flex gap-2.5">
                      <button onClick={(e) => toggleCheck(post.id, e)} className="shrink-0 flex items-center mt-0.5">
                        {isChecked
                          ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                          : <Square className="h-3.5 w-3.5 text-muted-foreground opacity-40" />}
                      </button>
                      {post.imageUrl && (
                        <img src={post.imageUrl} alt="" className="h-12 w-16 rounded object-cover shrink-0"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug line-clamp-2">
                          {post.aiTitle ?? post.title}
                          {post.aiTitle && <Sparkles className="inline h-3 w-3 ml-1 text-violet-400 shrink-0" />}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {post.source?.name}
                          {post.categories?.length > 0 && <> · {post.categories.slice(0, 2).join(', ')}</>}
                          {' · '}{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                          {post.sourcePublishedAt && (
                            <> · orig {format(new Date(post.sourcePublishedAt), 'dd MMM yyyy')}</>
                          )}
                        </p>
                        {post.publishStatus === 'PUBLISHED' && <Badge variant="success" className="text-xs mt-0.5">Published</Badge>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums px-1 min-w-[56px] text-center">
              {page} / {totalPages || 1}
            </span>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <select value={perPage} onChange={e => setPerPage(Number(e.target.value))}
            className="h-7 rounded border border-border bg-secondary px-2 text-xs text-foreground focus:outline-none">
            {PER_PAGE.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      </div>

      {/* Right panel — preview pane */}
      {selected ? (
        <div className="flex-[1] min-w-0 flex flex-col overflow-hidden">
          {/* Action bar */}
          <div className="shrink-0 px-5 py-3 border-b border-border">
            {editMode ? (
              <div className="space-y-2">
                <Input value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
                  className="text-sm font-semibold h-8" placeholder="Title" />
                <textarea value={draft.excerpt} onChange={e => setDraft(p => ({ ...p, excerpt: e.target.value }))}
                  rows={2} placeholder="Excerpt"
                  className="w-full rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground" />
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-7 text-xs" onClick={() => updatePost.mutate(draft)} disabled={updatePost.isPending}>
                    {updatePost.isPending ? <Loader2 className="animate-spin" /> : <Save />}Save
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditMode(false)}>
                    <X />Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {selected.originalUrl && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground shrink-0" asChild>
                    <a href={selected.originalUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground shrink-0"
                  onClick={() => { setDraft({ title: selected.title ?? '', excerpt: selected.excerpt ?? '', content: selected.content ?? '' }); setEditMode(true) }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {selected.aiTitle && selected.aiTitle !== selected.title && (
                  <Button size="icon" variant={diffView ? 'default' : 'ghost'} className="h-7 w-7 shrink-0"
                    onClick={() => setDiffView(v => !v)} title="Toggle diff view">
                    <Columns3 className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button size="sm" className="h-7 text-xs" onClick={() => setPublishTarget(selected)}>
                  <Upload className="h-3 w-3 mr-1" />Publish
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShareTarget(selected)}>
                  <Share2 className="h-3 w-3 mr-1" />Share
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive ml-auto"
                  onClick={() => remove.mutate(selected.id)} disabled={remove.isPending}>
                  {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            )}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 pb-10">
            {!editMode && (
              <div className="space-y-3 mb-4">
                {diffView && selected.aiTitle ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Title diff</p>
                      <ContentDiffView original={selected.title ?? ''} rewritten={selected.aiTitle} />
                    </div>
                    {selected.aiSummary && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Summary diff</p>
                        <ContentDiffView original={selected.excerpt || selected.content?.slice(0, 500) || ''} rewritten={selected.aiSummary} />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Featured image — full width, natural aspect ratio */}
                    {selected.imageUrl && (
                      <img src={selected.imageUrl} alt=""
                        className="w-full rounded-lg object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    )}

                    {/* Title */}
                    <h1 className="text-base font-semibold leading-snug mt-2">
                      {selected.aiTitle ?? selected.title}
                      {selected.aiTitle && <Sparkles className="inline h-3.5 w-3.5 ml-1.5 text-violet-400" />}
                    </h1>
                    {selected.aiTitle && selected.aiTitle !== selected.title && (
                      <p className="text-xs text-muted-foreground opacity-60 -mt-2">Original: {selected.title}</p>
                    )}
                  </>
                )}

                {/* Byline */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">{selected.source?.name}</span>
                  {selected.author && <><span>·</span><span>{selected.author}</span></>}
                  <span>·</span>
                  <span>{format(new Date(selected.createdAt), 'dd MMM yyyy, HH:mm')}</span>
                  {selected.sourcePublishedAt && (
                    <><span>·</span><span className="text-amber-500/80">orig {format(new Date(selected.sourcePublishedAt), 'dd MMM yyyy')}</span></>
                  )}
                  {selected.originalUrl && (() => {
                    try {
                      const domain = new URL(selected.originalUrl).hostname.replace(/^www\./, '')
                      return (
                        <>
                          <span>·</span>
                          <a href={selected.originalUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-primary hover:underline">
                            {domain} <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </>
                      )
                    } catch { return null }
                  })()}
                </div>

                {/* Editable categories */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  {(localCats ?? selected.categories ?? []).map((c: string) => (
                    <span key={c} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                      {c}
                      <button className="text-muted-foreground hover:text-foreground leading-none" onClick={() => {
                        const next = (localCats ?? selected.categories ?? []).filter((x: string) => x !== c)
                        setLocalCats(next)
                        updatePost.mutate({ categories: next } as any)
                      }}>×</button>
                    </span>
                  ))}
                  <input
                    value={catInput}
                    onChange={e => setCatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key !== 'Enter') return
                      const val = catInput.trim()
                      if (!val) return
                      const cur = localCats ?? selected.categories ?? []
                      if (cur.includes(val)) { setCatInput(''); return }
                      const next = [...cur, val]
                      setLocalCats(next)
                      setCatInput('')
                      updatePost.mutate({ categories: next } as any)
                    }}
                    placeholder="+ category"
                    className="h-5 w-24 text-xs bg-transparent border-b border-border/60 focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
                  />
                  {selected.publishStatus === 'PUBLISHED' && <Badge variant="success" className="text-xs">Published</Badge>}
                  {selected.language && selected.language !== 'en' && (
                    <Badge variant="outline" className="text-xs font-mono">{selected.language}</Badge>
                  )}
                  {selected.qualityScore != null && (
                    <Badge variant="outline" className={`text-xs ${selected.qualityScore >= 60 ? 'text-emerald-400 border-emerald-500/30' : selected.qualityScore >= 30 ? 'text-yellow-400 border-yellow-500/30' : 'text-muted-foreground'}`}>
                      Q:{selected.qualityScore}
                    </Badge>
                  )}
                  {selected.semanticDupOf && (
                    <Badge variant="outline" className="text-xs text-orange-400 border-orange-500/30">Semantic dup</Badge>
                  )}
                </div>

                {/* AI Tags */}
                {selected.aiTags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selected.aiTags.map((tag: string) => (
                      <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-[11px] text-violet-400">
                        # {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* AI Summary */}
                {selected.aiSummary && (
                  <div className="rounded-md bg-violet-500/10 border border-violet-500/20 px-3 py-2.5 text-xs text-foreground/80 leading-relaxed">
                    <div className="flex items-center gap-1.5 mb-1.5 text-violet-400">
                      <Sparkles className="h-3 w-3" /><span className="font-medium">AI Summary</span>
                    </div>
                    {selected.aiSummary}
                  </div>
                )}
              </div>
            )}

            {editMode ? (
              <RichTextEditor
                value={draft.content ?? ''}
                onChange={html => setDraft(p => ({ ...p, content: html }))}
                placeholder="Write content…"
              />
            ) : (
              /* Content is sanitized server-side by the 10-pass cheerio pipeline */
              <div
                className={[
                  'text-sm text-foreground/90 leading-relaxed',
                  '[&_p]:mb-3 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mb-2',
                  '[&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mb-2',
                  '[&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1.5',
                  '[&_img]:max-w-full [&_img]:rounded-md [&_img]:my-2',
                  '[&_a]:text-primary [&_a]:underline',
                  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3',
                  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3',
                  '[&_li]:mb-1',
                  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:mb-3',
                  '[&_iframe]:w-full [&_iframe]:aspect-video [&_iframe]:rounded-md [&_iframe]:my-3',
                  '[&_figure]:my-3 [&_figcaption]:text-xs [&_figcaption]:text-muted-foreground [&_figcaption]:mt-1',
                ].join(' ')}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-[1] flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <FileText className="h-10 w-10 opacity-20 mx-auto" />
            <p className="text-sm">Select a post to preview</p>
          </div>
        </div>
      )}

      {/* Bulk publish dialog */}
      <Dialog open={bulkDialog} onOpenChange={setBulkDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Bulk Publish {checkedIds.size} Posts</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-xs">Destination site</Label>
            <select value={bulkSiteId} onChange={e => setBulkSiteId(e.target.value)}
              className="w-full h-8 rounded-md border border-border bg-secondary px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="">Select a site…</option>
              {sitesData?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(false)}>Cancel</Button>
            <Button onClick={() => bulkPublish.mutate()} disabled={!bulkSiteId || bulkPublish.isPending}>
              {bulkPublish.isPending && <Loader2 className="animate-spin" />}
              Publish {checkedIds.size} posts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {publishTarget && (
        <PublishDialog post={publishTarget} open={!!publishTarget} onClose={() => setPublishTarget(null)} />
      )}
      {shareTarget && (
        <ShareDialog post={shareTarget} open={!!shareTarget} onClose={() => setShareTarget(null)} />
      )}
      <ShortcutHelp open={shortcutHelp} onClose={() => setShortcutHelp(false)} />
    </div>
  )
}
