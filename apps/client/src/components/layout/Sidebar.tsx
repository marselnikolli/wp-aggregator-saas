import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Globe, Rss, FileText, Settings, Zap, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/context/AuthContext'

const nav = [
  { to: '/',         label: 'Dashboard', icon: LayoutDashboard },
  { to: '/sites',    label: 'Sites',     icon: Globe },
  { to: '/sources',  label: 'Sources',   icon: Rss },
  { to: '/posts',    label: 'Posts',     icon: FileText },
  { to: '/settings', label: 'Settings',  icon: Settings },
]

export function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-sm text-foreground">WP Aggregator</span>
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <Separator />

      {/* Footer */}
      <div className="p-3 space-y-1">
        <div className="px-3 py-1">
          <p className="text-xs font-medium text-foreground truncate">{user?.name ?? user?.email}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
