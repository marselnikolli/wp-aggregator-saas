import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, Globe, Rss, FileText, Settings, Zap, LogOut, Activity, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/context/AuthContext'
import { dashboardApi } from '@/lib/api'

const nav = [
  { to: '/',         label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sites',    label: 'Sites',     icon: Globe           },
  { to: '/sources',  label: 'Sources',   icon: Rss             },
  { to: '/posts',    label: 'Posts',     icon: FileText        },
  { to: '/settings', label: 'Settings',  icon: Settings        },
]

export function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [queueOpen, setQueueOpen] = useState(false)

  const { data: queueData } = useQuery({
    queryKey: ['queue-stats'],
    queryFn:  dashboardApi.queues,
    refetchInterval: 10_000,
    retry: false,
  })

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const fetchFailed   = queueData?.fetch?.failed   ?? 0
  const publishFailed = queueData?.publish?.failed ?? 0
  const fetchActive   = queueData?.fetch?.active   ?? 0
  const publishActive = queueData?.publish?.active ?? 0
  const hasFailed = fetchFailed > 0 || publishFailed > 0
  const hasActive = fetchActive > 0 || publishActive > 0

  const dotClass = hasFailed
    ? 'bg-red-500'
    : hasActive
    ? 'bg-yellow-500 animate-pulse'
    : 'bg-muted-foreground/20'

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm text-foreground">WP Aggregator</span>
      </div>

      <Separator />

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Queue panel */}
      <div className="px-3 pb-1">
        <button
          onClick={() => setQueueOpen(o => !o)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <Activity className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Queues</span>
          <span className={cn('h-2 w-2 rounded-full', dotClass)} />
          {queueOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {queueOpen && queueData && (
          <div className="mt-1 rounded-md border border-border bg-secondary/50 p-3 space-y-3">
            {(['fetch', 'publish'] as const).map(key => {
              const d = queueData[key] as { waiting: number; active: number; failed: number }
              return (
                <div key={key}>
                  <p className="text-xs font-medium text-foreground mb-1 capitalize">{key}</p>
                  <div className="grid grid-cols-3 gap-1 text-center">
                    {(['waiting', 'active', 'failed'] as const).map(k => (
                      <div key={k}>
                        <p className={cn('text-sm font-bold tabular-nums',
                          k === 'failed' && d[k] > 0 ? 'text-red-400' :
                          k === 'active' && d[k] > 0 ? 'text-yellow-400' : 'text-foreground')}>
                          {d[k] ?? 0}
                        </p>
                        <p className="text-xs text-muted-foreground">{k}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Separator />

      <div className="p-3 space-y-1">
        <div className="px-3 py-1">
          <p className="text-xs font-medium text-foreground truncate">{user?.name ?? user?.email}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </div>
        <button onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
