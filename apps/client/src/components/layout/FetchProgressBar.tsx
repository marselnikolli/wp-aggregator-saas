import { useState, useEffect, useRef } from 'react'
import { X, Loader2, CheckCircle2, XCircle } from 'lucide-react'

type JobStatus = 'active' | 'running' | 'done' | 'failed'

interface SourceJob {
  sourceName: string
  status:     JobStatus
  pct:        number
  phase:      string
}

export function FetchProgressBar() {
  const [jobs, setJobs]       = useState<Record<string, SourceJob>>({})
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const clearTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const token = localStorage.getItem('token')
    const url   = token
      ? `/aggregator/api/sources/events?token=${encodeURIComponent(token)}`
      : '/aggregator/api/sources/events'
    const es = new EventSource(url)

    es.addEventListener('job:active', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      if (!d.sourceId) return
      clearTimeout(clearTimers.current[d.sourceId])
      setDismissed(false)
      setVisible(true)
      setJobs(prev => ({
        ...prev,
        [d.sourceId]: { sourceName: d.sourceName ?? d.sourceId, status: 'active', pct: 0, phase: 'starting…' },
      }))
    })

    es.addEventListener('job:progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      if (!d.sourceId) return
      clearTimeout(clearTimers.current[d.sourceId])
      setJobs(prev => ({
        ...prev,
        [d.sourceId]: {
          sourceName: d.sourceName ?? prev[d.sourceId]?.sourceName ?? d.sourceId,
          status: 'running',
          pct:   d.progress?.pct   ?? prev[d.sourceId]?.pct ?? 0,
          phase: d.progress?.phase ?? prev[d.sourceId]?.phase ?? '',
        },
      }))
    })

    es.addEventListener('job:completed', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      if (!d.sourceId) return
      setJobs(prev => prev[d.sourceId]
        ? { ...prev, [d.sourceId]: { ...prev[d.sourceId], status: 'done', pct: 100 } }
        : prev
      )
      clearTimers.current[d.sourceId] = setTimeout(() => {
        setJobs(prev => {
          const next = { ...prev }
          delete next[d.sourceId]
          return next
        })
      }, 3000)
    })

    es.addEventListener('job:failed', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      if (!d.sourceId) return
      setJobs(prev => prev[d.sourceId]
        ? { ...prev, [d.sourceId]: { ...prev[d.sourceId], status: 'failed', phase: 'failed' } }
        : prev
      )
      clearTimers.current[d.sourceId] = setTimeout(() => {
        setJobs(prev => {
          const next = { ...prev }
          delete next[d.sourceId]
          return next
        })
      }, 5000)
    })

    return () => {
      es.close()
      Object.values(clearTimers.current).forEach(clearTimeout)
    }
  }, [])

  // Auto-hide when all jobs cleared
  useEffect(() => {
    if (Object.keys(jobs).length === 0 && visible) {
      const t = setTimeout(() => setVisible(false), 500)
      return () => clearTimeout(t)
    }
  }, [jobs, visible])

  if (!visible || dismissed) return null

  const entries = Object.entries(jobs)
  const totalPct = entries.length
    ? Math.round(entries.reduce((s, [, j]) => s + j.pct, 0) / entries.length)
    : 0
  const allDone = entries.every(([, j]) => j.status === 'done' || j.status === 'failed')

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur shadow-lg">
      {/* Overall progress bar */}
      <div className="h-1 w-full bg-secondary">
        <div
          className={`h-full transition-all duration-500 ease-out ${allDone ? 'bg-emerald-500' : 'bg-primary'}`}
          style={{ width: `${totalPct}%` }}
        />
      </div>

      <div className="flex items-start gap-3 px-4 py-2.5">
        {/* Source rows */}
        <div className="flex-1 min-w-0 flex flex-wrap gap-x-6 gap-y-1.5">
          {entries.map(([id, job]) => (
            <div key={id} className="flex items-center gap-2 min-w-0">
              {job.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
              {job.status === 'failed' && <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
              {(job.status === 'active' || job.status === 'running') && (
                <Loader2 className="h-3.5 w-3.5 text-primary shrink-0 animate-spin" />
              )}
              <span className="text-xs font-medium truncate max-w-[160px]">{job.sourceName}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-20 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      job.status === 'done'   ? 'bg-emerald-500' :
                      job.status === 'failed' ? 'bg-destructive'  : 'bg-primary'
                    }`}
                    style={{ width: `${job.pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground w-7 text-right tabular-nums">
                  {job.status === 'done' ? '✓' : job.status === 'failed' ? '✗' : `${job.pct}%`}
                </span>
              </div>
              {job.phase && job.status === 'running' && (
                <span className="text-[10px] text-muted-foreground hidden sm:inline">{job.phase}</span>
              )}
            </div>
          ))}
        </div>

        {/* Summary + dismiss */}
        <div className="flex items-center gap-3 shrink-0 self-center">
          <span className="text-xs text-muted-foreground tabular-nums">
            {allDone
              ? `${entries.length} source${entries.length !== 1 ? 's' : ''} done`
              : `${entries.filter(([, j]) => j.status === 'running' || j.status === 'active').length} / ${entries.length} fetching`
            }
          </span>
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
