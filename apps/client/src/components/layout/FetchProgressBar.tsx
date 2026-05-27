import { useState, useEffect, useRef } from 'react'

interface SourceProgress {
  pct: number
  sourceName: string
}

export function FetchProgressBar() {
  const [active, setActive] = useState<Record<string, SourceProgress>>({})
  const clearTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    const token = localStorage.getItem('token')
    const url = token
      ? `/api/sources/events?token=${encodeURIComponent(token)}`
      : '/api/sources/events'
    const es = new EventSource(url)

    es.addEventListener('job:progress', (e) => {
      const d = JSON.parse((e as MessageEvent).data)
      if (!d.sourceId) return
      clearTimeout(clearTimers.current[d.sourceId])
      setActive(prev => ({
        ...prev,
        [d.sourceId]: { pct: d.progress?.pct ?? 0, sourceName: d.sourceName ?? d.sourceId },
      }))
    })

    const clearSource = (e: MessageEvent) => {
      const d = JSON.parse(e.data)
      if (!d.sourceId) return
      clearTimers.current[d.sourceId] = setTimeout(() => {
        setActive(prev => {
          const next = { ...prev }
          delete next[d.sourceId]
          return next
        })
      }, 2000)
    }

    es.addEventListener('job:completed', clearSource as EventListener)
    es.addEventListener('job:failed',    clearSource as EventListener)

    return () => {
      es.close()
      Object.values(clearTimers.current).forEach(clearTimeout)
    }
  }, [])

  const entries = Object.values(active)
  if (!entries.length) return null

  const avgPct = Math.round(entries.reduce((s, e) => s + e.pct, 0) / entries.length)
  const tooltip = entries.length === 1
    ? `Fetching ${entries[0].sourceName}… ${entries[0].pct}%`
    : entries.map(e => `${e.sourceName}: ${e.pct}%`).join('\n')

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-transparent"
      title={tooltip}
    >
      <div
        className="h-full bg-primary transition-all duration-300 ease-out"
        style={{ width: `${avgPct}%` }}
      />
    </div>
  )
}
