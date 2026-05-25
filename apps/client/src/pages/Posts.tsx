import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle, XCircle, Upload, Trash2, FileText,
  Loader2, ExternalLink, ChevronLeft, ChevronRight,
  Pencil, Save, X, CheckSquare, Square, Keyboard, Sparkles,
} from 'lucide-react'
import { formatDistanceToNow, format, sub } from 'date-fns'
import { toast } from 'sonner'
import { postsApi, sitesApi, sourcesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const TABS     = ['PENDING', 'APPROVED', 'REJECTED'] as const
const PER_PAGE = [10, 25, 50, 100] as const

const DATE_PRESETS = [
  { label: 'All time',      days: 0  },
  { label: 'Today',         days: 1  },
  { label: 'Last 7 days',   days: 7  },
  { label: 'Last 30 days',  days: 30 },
  { label: 'Last 3 months', days: 90 },
]

const SHORTCUTS = [
  { key: 'j / k', desc: 'Navigate posts' },
  { key: 'a',     desc: 'Approve post'   },
  { key: 'r',     desc: 'Reject post'    },
  { key: 'e',     desc: 'Toggle edit'    },
  { key: 'Esc',   desc: 'Cancel / clear' },
]

function dateFromPreset(days: number) {
  if (!days) return ''
  return sub(new Date(), { days }).toISOString()
}

const WP_STATUS_OPTIONS = [
  { value: 'publish', label: 'Publish now',   desc: 'Go live immediately' },
  { value: 'draft',   label: 'Save as draft', desc: 'Hidden until manually published' },
  { value: 'future',  label: 'Schedule',      desc: 'Publish at a specific time' },
] as const

function PublishDialog({ post, open, onClose }: { post: any; open: boolean; onClose: () => void }) {
  const [selected, setSelected]     = useState<string[]>([])
  const [wpStatus, setWpStatus]     = useState<'publish' | 'draft' | 'future'>('publish')
  const [scheduleAt, setScheduleAt] = useState('')
  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })
  const qc = useQueryClient()

  const publish = useMutation({
    mutationFn: () => {
      const isoDate = wpStatus === 'future' && scheduleAt
        ? new Date(scheduleAt).toISOString()
        : undefined
      return postsApi.publish(post.id, selected, wpStatus, isoDate)
    },
    onSuccess: (d) => {
      toast.success(`Queued for ${d.queued} site(s)`)
      qc.invalidateQueries({ queryKey: ['posts'] })
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Publish failed'),
  })

  const canSubmit = selected.length > 0 && (wpStatus !== 'future' || !!scheduleAt)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Publish to Sites</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">Destination for: <strong>{post?.title}</strong></p>

          {/* Site selection */}
          <div className="space-y-2">
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

          {/* Status */}
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <div className="flex gap-2">
              {WP_STATUS_OPTIONS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setWpStatus(opt.value)}
                  className={`flex-1 rounded-md border py-2 px-1 text-xs transition-colors text-center ${wpStatus === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-border/80'}`}>
                  <span className="block font-medium text-sm">{opt.label}</span>
                  <span className="block text-[11px] opacity-70">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {wpStatus === 'future' && (
            <div className="grid gap-1.5">
              <Label>Schedule date &amp; time</Label>
              <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)}
                className="h-9 rounded-md border border-border bg-secondary px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => publish.mutate()} disabled={!canSubmit || publish.isPending}>
            {publish.isPending && <Loader2 className="animate-spin" />}
            {wpStatus === 'draft' ? 'Save draft' : wpStatus === 'future' ? 'Schedule' : `Publish to ${selected.length} site${selected.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [tab,           setTab]           = useState<typeof TABS[number]>('PENDING')
  const [page,          setPage]          = useState(1)
  const [perPage,       setPerPage]       = useState(25)
  const [sourceId,      setSourceId]      = useState('')
  const [category,      setCategory]      = useState('')
  const [dateDays,      setDateDays]      = useState(0)
  const [selected,      setSelected]      = useState<any>(null)
  const [publishTarget, setPublishTarget] = useState<any>(null)
  const [checkedIds,    setCheckedIds]    = useState<Set<string>>(new Set())
  const [editMode,      setEditMode]      = useState(false)
  const [draft,         setDraft]         = useState({ title: '', excerpt: '', content: '' })
  const [shortcutHelp,  setShortcutHelp]  = useState(false)
  const qc = useQueryClient()

  useEffect(() => { setPage(1); setCategory('') }, [sourceId])
  useEffect(() => { setPage(1) }, [tab, category, dateDays, perPage])
  useEffect(() => { setCheckedIds(new Set()) }, [tab, page])
  useEffect(() => { setEditMode(false) }, [selected?.id])

  const dateFrom = useMemo(() => dateFromPreset(dateDays), [dateDays])

  const { data, isLoading } = useQuery({
    queryKey: ['posts', tab, page, perPage, sourceId, category, dateDays],
    queryFn: () => postsApi.list({
      approvalStatus: tab,
      page,
      per_page: perPage,
      ...(sourceId && { sourceId }),
      ...(category && { category }),
      ...(dateFrom && { dateFrom }),
    }),
    placeholderData: (prev: any) => prev,
    refetchInterval: 15_000,
  })

  const { data: sourcesData } = useQuery({
    queryKey: ['sources', 'all'],
    queryFn:  () => sourcesApi.list({ per_page: 100 }),
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

  const approve = useMutation({
    mutationFn: (id: string) => postsApi.approve(id),
    onSuccess: () => { invalidate(); toast.success('Approved') },
  })
  const reject = useMutation({
    mutationFn: (id: string) => postsApi.reject(id),
    onSuccess: () => { invalidate(); toast.success('Rejected') },
  })
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

  const bulkApprove = useMutation({
    mutationFn: () => Promise.allSettled([...checkedIds].map(id => postsApi.approve(id))),
    onSuccess: (results) => {
      const ok = results.filter(r => r.status === 'fulfilled').length
      const err = results.filter(r => r.status === 'rejected').length
      err ? toast.error(`${ok} approved, ${err} failed`) : toast.success(`${ok} posts approved`)
      invalidate(); setCheckedIds(new Set())
    },
  })
  const bulkReject = useMutation({
    mutationFn: () => Promise.allSettled([...checkedIds].map(id => postsApi.reject(id))),
    onSuccess: (results) => {
      const ok = results.filter(r => r.status === 'fulfilled').length
      const err = results.filter(r => r.status === 'rejected').length
      err ? toast.error(`${ok} rejected, ${err} failed`) : toast.success(`${ok} posts rejected`)
      invalidate(); setCheckedIds(new Set())
    },
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
        case 'a': if (selected && !approve.isPending) approve.mutate(selected.id); break
        case 'r': if (selected && !reject.isPending) reject.mutate(selected.id); break
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
  }, [posts, selected, editMode, checkedIds, approve.isPending, reject.isPending])

  const allChecked  = posts.length > 0 && checkedIds.size === posts.length
  const someChecked = checkedIds.size > 0 && checkedIds.size < posts.length

  // Content sanitized server-side by cheerio before DB storage (scripts/ads stripped)
  const htmlContent = selected?.content
    ?? (selected?.excerpt ? `<p>${selected.excerpt.replace(/<[^>]+>/g, '')}</p>` : '<p><em>No content available.</em></p>')

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
          </div>
          <div className="flex gap-1 pt-0.5">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={cn('flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
                  tab === t ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk action bar */}
        {checkedIds.size > 0 && (
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-primary/5 border-b border-border">
            <span className="text-xs text-muted-foreground flex-1">{checkedIds.size} selected</span>
            <button onClick={() => setCheckedIds(new Set())} className="text-xs text-muted-foreground hover:text-foreground mr-1">Clear</button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
              onClick={() => bulkApprove.mutate()} disabled={bulkApprove.isPending}>
              {bulkApprove.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle />}Approve
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
              onClick={() => bulkReject.mutate()} disabled={bulkReject.isPending}>
              {bulkReject.isPending ? <Loader2 className="animate-spin" /> : <XCircle />}Reject
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
              <p className="text-sm">No {tab.toLowerCase()} posts</p>
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

      {/* Right panel */}
      {selected ? (
        <div className="flex-[1] min-w-0 flex flex-col overflow-hidden">
          <div className="shrink-0 px-5 py-4 border-b border-border">
            {editMode ? (
              <div className="space-y-2">
                <Input value={draft.title} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
                  className="text-sm font-semibold h-8" placeholder="Title" />
                <textarea value={draft.excerpt} onChange={e => setDraft(p => ({ ...p, excerpt: e.target.value }))}
                  rows={3} placeholder="Excerpt"
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
              <>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold leading-snug">
                    {selected.aiTitle ?? selected.title}
                    {selected.aiTitle && <Sparkles className="inline h-3 w-3 ml-1.5 text-violet-400" />}
                  </h2>
                  {selected.aiTitle && selected.aiTitle !== selected.title && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5 opacity-60">Original: {selected.title}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                    <span>{selected.source?.name}</span>
                    {selected.categories?.length > 0 && (<><span>·</span><span>{selected.categories.join(', ')}</span></>)}
                    <span>·</span>
                    <span>{format(new Date(selected.createdAt), 'dd MMM yyyy')}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <Badge variant={selected.approvalStatus === 'APPROVED' ? 'success' : selected.approvalStatus === 'REJECTED' ? 'destructive' : 'secondary'} className="text-xs">
                      {selected.approvalStatus}
                    </Badge>
                    {selected.publishStatus === 'PUBLISHED' && <Badge variant="success" className="text-xs">Published</Badge>}
                    {selected.language && selected.language !== 'en' && (
                      <Badge variant="outline" className="text-xs font-mono">{selected.language}</Badge>
                    )}
                    {selected.qualityScore != null && (
                      <Badge variant="outline" className={`text-xs ${selected.qualityScore >= 60 ? 'text-emerald-400 border-emerald-500/30' : selected.qualityScore >= 30 ? 'text-yellow-400 border-yellow-500/30' : 'text-muted-foreground'}`}>
                        Q:{selected.qualityScore}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-3">
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
                  {tab === 'PENDING' && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                        onClick={() => approve.mutate(selected.id)} disabled={approve.isPending}>
                        {approve.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle />}Approve
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                        onClick={() => reject.mutate(selected.id)} disabled={reject.isPending}>
                        {reject.isPending ? <Loader2 className="animate-spin" /> : <XCircle />}Reject
                      </Button>
                    </>
                  )}
                  {tab === 'APPROVED' && selected.publishStatus !== 'PUBLISHED' && (
                    <Button size="sm" className="h-7 text-xs" onClick={() => setPublishTarget(selected)}>
                      <Upload />Publish
                    </Button>
                  )}
                  {selected.publishStatus === 'PUBLISHED' && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPublishTarget(selected)}>
                      <Upload />Republish
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive ml-auto"
                    onClick={() => remove.mutate(selected.id)} disabled={remove.isPending}>
                    {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {selected.imageUrl && (
              <img src={selected.imageUrl} alt="" className="w-full rounded-md object-cover max-h-52"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
            {selected.aiSummary && !editMode && (
              <div className="rounded-md bg-violet-500/10 border border-violet-500/20 px-3 py-2.5 text-xs text-foreground/80 leading-relaxed">
                <div className="flex items-center gap-1.5 mb-1.5 text-violet-400">
                  <Sparkles className="h-3 w-3" />
                  <span className="font-medium text-xs">AI Summary</span>
                </div>
                {selected.aiSummary}
              </div>
            )}
            {editMode ? (
              <textarea value={draft.content} onChange={e => setDraft(p => ({ ...p, content: e.target.value }))}
                className="w-full min-h-[300px] rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="HTML content" />
            ) : (
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

      {publishTarget && (
        <PublishDialog post={publishTarget} open={!!publishTarget} onClose={() => setPublishTarget(null)} />
      )}
      <ShortcutHelp open={shortcutHelp} onClose={() => setShortcutHelp(false)} />
    </div>
  )
}
