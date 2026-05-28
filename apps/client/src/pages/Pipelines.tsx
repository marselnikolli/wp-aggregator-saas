import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Play, Pencil, Trash2, Zap, CheckCircle, Languages, ArrowRight,
  Share2, Loader2, FileText, Globe, CheckCircle2, AlertCircle, LucideIcon,
  ListTree, Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { pipelinesApi, dashboardApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

const SCHEDULE_PRESETS = [
  { label: 'Hourly',        value: '0 * * * *' },
  { label: 'Every 6h',     value: '0 */6 * * *' },
  { label: 'Daily 8am',    value: '0 8 * * *' },
  { label: 'Daily 6pm',    value: '0 18 * * *' },
  { label: 'Weekdays 8am', value: '0 8 * * 1-5' },
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
  postLimit: number
  aiPrompt: string | null
  socialAccountId: string | null
  socialTemplate: string | null
  languageSiteMapping: Record<string, string[]> | null
  categoryMappings: Array<{
    sourceId: string; sourceCategory: string
    destCategoryId: number | null; destCategoryName: string | null
  }> | null
}

// ─── Pipelines list page ──────────────────────────────────────────────────────

export function Pipelines() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [flowPipeline, setFlowPipeline] = useState<Pipeline | null>(null)

  const { data: pipelines = [], isLoading } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pipelines'] })

  const remove = useMutation({
    mutationFn: pipelinesApi.remove,
    onSuccess: () => { invalidate(); toast.success('Pipeline removed') },
  })
  const run = useMutation({
    mutationFn: pipelinesApi.run,
    onSuccess: (data, pipelineId) => {
      const p = (pipelines as Pipeline[]).find(x => x.id === pipelineId)
      if (p) setFlowPipeline(p)
      toast.success(`Pipeline run: ${data.queued} tasks queued`)
    },
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
        <Button onClick={() => navigate('/pipelines/new')} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Pipeline
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !(pipelines as Pipeline[]).length ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3 text-muted-foreground">
            <Zap className="h-10 w-10 opacity-20" />
            <p className="text-sm">No pipelines yet. Create one to automate publishing.</p>
            <Button size="sm" onClick={() => navigate('/pipelines/new')}>Create your first pipeline</Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(pipelines as Pipeline[]).map(p => (
              <Card key={p.id} className={p.enabled ? '' : 'opacity-60'}>
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div>
                    <CardTitle className="text-sm font-semibold">{p.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                      {p.schedule
                        ? (SCHEDULE_PRESETS.find(s => s.value === p.schedule)?.label ?? p.schedule)
                        : 'Manual trigger only'}
                    </p>
                  </div>
                  <Switch checked={p.enabled} onCheckedChange={enabled => toggle.mutate({ id: p.id, enabled })} />
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Badge variant={p.defaultStatus === 'publish' ? 'success' : 'secondary'}>{p.defaultStatus}</Badge>
                    {p.autoPublish && <Badge variant="outline"><CheckCircle className="h-2.5 w-2.5 mr-1" />Auto</Badge>}
                    {p.qualityMin > 0 && <Badge variant="outline">Q≥{p.qualityMin}</Badge>}
                    <Badge variant="secondary">{p.siteIds.length} site{p.siteIds.length !== 1 ? 's' : ''}</Badge>
                    {p.sourceFilter?.length
                      ? <Badge variant="outline">{p.sourceFilter.length} source{p.sourceFilter.length !== 1 ? 's' : ''}</Badge>
                      : null}
                    {p.categoryFilter?.length
                      ? <Badge variant="outline" className="font-mono">{p.categoryFilter.slice(0, 2).join(', ')}{p.categoryFilter.length > 2 ? '…' : ''}</Badge>
                      : null}
                    {p.categoryMappings?.length
                      ? <Badge variant="outline" className="text-amber-400 border-amber-500/30">
                          <ListTree className="h-2.5 w-2.5 mr-1" />{p.categoryMappings.length} mapping{p.categoryMappings.length !== 1 ? 's' : ''}
                        </Badge>
                      : null}
                    {p.translateTo && (
                      <Badge variant="outline" className="text-blue-400 border-blue-500/30">
                        <Languages className="h-2.5 w-2.5 mr-1" />→{p.translateTo}
                      </Badge>
                    )}
                    {p.publishWindowHours > 0 && <Badge variant="outline">{p.publishWindowHours}h window</Badge>}
                    {(p as any).postLimit && (p as any).postLimit !== 50 && (
                      <Badge variant="outline">max {(p as any).postLimit}</Badge>
                    )}
                    {p.aiPrompt && (
                      <Badge variant="outline" className="text-violet-400 border-violet-500/30">
                        <Sparkles className="h-2.5 w-2.5 mr-1" />AI rewrite
                      </Badge>
                    )}
                    {p.socialAccountId && (
                      <Badge variant="outline" className="text-blue-400 border-blue-500/30">
                        <Share2 className="h-2.5 w-2.5 mr-1" />{p.socialTemplate ?? 'social'}
                      </Badge>
                    )}
                    {p.languageSiteMapping && Object.keys(p.languageSiteMapping).length > 0 && (
                      <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">
                        <Languages className="h-2.5 w-2.5 mr-1" />Lang routing
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1"
                      onClick={() => run.mutate(p.id)} disabled={run.isPending}>
                      <Play className="h-3 w-3 mr-1" /> Run now
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8"
                      onClick={() => navigate(`/pipelines/${p.id}/edit`)}>
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

      <PipelineFlowDialog
        pipeline={flowPipeline}
        open={!!flowPipeline}
        onClose={() => setFlowPipeline(null)}
      />
    </div>
  )
}

// ─── Pipeline run workflow dialog ─────────────────────────────────────────────

interface Stage {
  id: string
  label: string
  icon: LucideIcon
  status: 'idle' | 'active' | 'done' | 'error'
  detail?: string
}

function PipelineFlowDialog({ pipeline, open, onClose }: { pipeline: Pipeline | null; open: boolean; onClose: () => void }) {
  const [stages, setStages] = useState<Stage[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const queueQuery = useQuery({
    queryKey: ['queue-stats'],
    queryFn: dashboardApi.queues,
    enabled: false,
    refetchInterval: 2000,
  })

  useEffect(() => {
    if (!open) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    setStages([
      { id: 'select',  label: 'Select posts',    icon: FileText,     status: 'idle' },
      { id: 'publish', label: 'Publish to sites', icon: Globe,        status: 'idle' },
      ...(pipeline?.socialAccountId
        ? [{ id: 'social', label: 'Share to social', icon: Share2, status: 'idle' as const }]
        : []),
      { id: 'done', label: 'Complete', icon: CheckCircle2, status: 'idle' as const },
    ])
    queueQuery.refetch()
    const t = setInterval(() => queueQuery.refetch(), 2000)
    intervalRef.current = t
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [open, pipeline?.socialAccountId])

  useEffect(() => {
    if (!open || !queueQuery.data) return
    const q = queueQuery.data as any

    const any = (key: string, field: string) => q[key]?.[field] ?? 0
    const publishActive = any('publish', 'active') > 0 || any('publish', 'waiting') > 0
    const socialActive  = any('social', 'active')  > 0 || any('social', 'waiting')  > 0
    const publishDone   = !publishActive && (any('publish', 'completed') > 0 || any('publish', 'failed') > 0)
    const socialDone    = !socialActive  && (any('social', 'completed')  > 0 || any('social', 'failed')  > 0)
    const hasTasks      = ['publish', 'social', 'fetch', 'summarize'].some(k =>
      any(k, 'completed') > 0 || any(k, 'failed') > 0 || any(k, 'active') > 0 || any(k, 'waiting') > 0
    )

    setStages(prev => prev.map(s => {
      if (s.id === 'select')  return { ...s, status: 'done' as const }
      if (s.id === 'publish') {
        if (publishActive)       return { ...s, status: 'active', detail: `active: ${any('publish', 'active')}, waiting: ${any('publish', 'waiting')}` }
        if (any('publish', 'failed') > 0) return { ...s, status: 'error', detail: `${any('publish', 'failed')} failed` }
        if (publishDone) return { ...s, status: 'done' }
        return s
      }
      if (s.id === 'social') {
        if (socialActive)        return { ...s, status: 'active', detail: `active: ${any('social', 'active')}, waiting: ${any('social', 'waiting')}` }
        if (any('social', 'failed') > 0)  return { ...s, status: 'error', detail: `${any('social', 'failed')} failed` }
        if (socialDone) return { ...s, status: 'done' }
        return s
      }
      if (s.id === 'done') {
        if (hasTasks && !publishActive && !socialActive) return { ...s, status: 'done' }
        return s
      }
      return s
    }))
  }, [queueQuery.data, open])

  const allDone = stages.every(s => s.status === 'done' || s.status === 'idle')

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            {pipeline?.name ?? 'Pipeline'} — Workflow
          </DialogTitle>
        </DialogHeader>

        <div className="py-6">
          <div className="flex items-start justify-center gap-0">
            {stages.map((stage, i) => (
              <div key={stage.id} className="flex items-start">
                <div className="flex flex-col items-center gap-2 min-w-[120px]">
                  <div className={`
                    relative flex h-14 w-14 items-center justify-center rounded-xl border-2 transition-all duration-500
                    ${stage.status === 'active' ? 'border-primary bg-primary/10 animate-pulse shadow-lg shadow-primary/20' : ''}
                    ${stage.status === 'done'   ? 'border-emerald-500 bg-emerald-500/10' : ''}
                    ${stage.status === 'error'  ? 'border-destructive bg-destructive/10' : ''}
                    ${stage.status === 'idle'   ? 'border-border bg-secondary/50 text-muted-foreground' : ''}
                  `}>
                    {stage.status === 'done'   ? <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    : stage.status === 'error' ? <AlertCircle  className="h-6 w-6 text-destructive" />
                    : stage.status === 'active'? <Loader2      className="h-6 w-6 text-primary animate-spin" />
                    : <stage.icon className="h-6 w-6" />}
                  </div>
                  <p className={`text-xs font-medium text-center leading-tight ${stage.status === 'idle' ? 'text-muted-foreground' : 'text-foreground'}`}>
                    {stage.label}
                  </p>
                  {stage.detail && <p className="text-[10px] text-muted-foreground text-center">{stage.detail}</p>}
                </div>
                {i < stages.length - 1 && (
                  <div className="flex items-center pt-7 px-2">
                    <div className={`h-px w-8 border-t-2 transition-colors duration-500 ${stages[i + 1]?.status === 'active' || stages[i + 1]?.status === 'done' ? 'border-primary' : 'border-border'}`} />
                    <ArrowRight className={`h-3.5 w-3.5 -ml-1 transition-colors duration-500 ${stages[i + 1]?.status === 'active' || stages[i + 1]?.status === 'done' ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-md bg-secondary/30 border border-border p-3 text-xs text-muted-foreground space-y-1">
            {!queueQuery.data ? (
              <p>Run started — waiting for queue data…</p>
            ) : (
              <>
                <p>Publish: {queueQuery.data.publish?.waiting ?? '—'} waiting · {queueQuery.data.publish?.active ?? '—'} active · {queueQuery.data.publish?.failed ?? '—'} failed</p>
                {pipeline?.socialAccountId && (
                  <p>Social: {queueQuery.data.social?.waiting ?? '—'} waiting · {queueQuery.data.social?.active ?? '—'} active · {queueQuery.data.social?.failed ?? '—'} failed</p>
                )}
                <p>Fetch: {queueQuery.data.fetch?.waiting ?? '—'} waiting · {queueQuery.data.fetch?.active ?? '—'} active · {queueQuery.data.fetch?.failed ?? '—'} failed</p>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {allDone ? 'Close' : 'Close (run in background)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
