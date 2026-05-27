import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { LayoutDashboard, Globe, Rss, FileText, Settings, Zap, LogOut, Activity, ChevronDown, ChevronUp, ExternalLink, ShieldCheck, Users, GitBranch, History, Sun, Moon, Share2, UserCheck, ListVideo, BarChart2, LayoutTemplate } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/context/AuthContext'
import { dashboardApi } from '@/lib/api'
import { useTheme } from '@/lib/theme'

const nav = [
  { to: '/',          label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sites',     label: 'Sites',     icon: Globe           },
  { to: '/sources',   label: 'Sources',   icon: Rss             },
  { to: '/posts',     label: 'Posts',     icon: FileText        },
  { to: '/pipelines', label: 'Pipelines', icon: GitBranch       },
  { to: '/history',   label: 'History',   icon: History         },
  { to: '/settings',  label: 'Settings',  icon: Settings        },
  { to: '/audit-log', label: 'Audit Log', icon: ShieldCheck     },
  { to: '/team',      label: 'Team',      icon: Users           },
]

const socialNav = [
  { to: '/social/accounts',   label: 'Accounts',  icon: UserCheck       },
  { to: '/social/queue',      label: 'Queue',     icon: ListVideo       },
  { to: '/social/analytics',  label: 'Analytics', icon: BarChart2       },
  { to: '/social/templates',  label: 'Templates', icon: LayoutTemplate  },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, toggle: toggleTheme } = useTheme()
  const [queueOpen, setQueueOpen] = useState(false)
  const [socialOpen, setSocialOpen] = useState(location.pathname.startsWith('/social'))

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

      <nav className="flex flex-1 flex-col gap-1 p-3 overflow-y-auto">
        {nav.slice(0, 6).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}>
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}

        {/* Social Media collapsible group */}
        <button
          onClick={() => setSocialOpen(o => !o)}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
            location.pathname.startsWith('/social')
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
          )}
        >
          <Share2 className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Social Media</span>
          {socialOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {socialOpen && (
          <div className="ml-3 border-l border-border/50 pl-3 flex flex-col gap-0.5">
            {socialNav.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to}
                onClick={onNavigate}
                className={({ isActive }) => cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}>
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </NavLink>
            ))}
          </div>
        )}

        {nav.slice(6).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to}
            onClick={onNavigate}
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
            {(['fetch', 'publish', 'summarize'] as const).map(key => {
              const d = (queueData[key] ?? {}) as { waiting?: number; active?: number; failed?: number }
              return (
                <div key={key}>
                  <p className="text-xs font-medium text-foreground mb-1 capitalize">{key}</p>
                  <div className="grid grid-cols-3 gap-1 text-center">
                    {(['waiting', 'active', 'failed'] as const).map(k => (
                      <div key={k}>
                        <p className={cn('text-sm font-bold tabular-nums',
                          k === 'failed' && (d[k] ?? 0) > 0 ? 'text-red-400' :
                          k === 'active' && (d[k] ?? 0) > 0 ? 'text-yellow-400' : 'text-foreground')}>
                          {d[k] ?? 0}
                        </p>
                        <p className="text-xs text-muted-foreground">{k}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            <a
              href="/admin/queues/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground pt-1 border-t border-border/50"
            >
              <ExternalLink className="h-3 w-3" />
              Queue Inspector
            </a>
          </div>
        )}
      </div>

      <Separator />

      <div className="p-3 space-y-1">
        <div className="px-3 py-1">
          <p className="text-xs font-medium text-foreground truncate">{user?.name ?? user?.email}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </div>
        <div className="flex gap-1">
          <button onClick={toggleTheme}
            className="flex flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
            {theme === 'dark' ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
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
