import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { FetchProgressBar } from '@/components/layout/FetchProgressBar'
import { Dashboard } from '@/pages/Dashboard'
import { Sites }     from '@/pages/Sites'
import { Sources }   from '@/pages/Sources'
import { Posts }     from '@/pages/Posts'
import { Settings }  from '@/pages/Settings'
import { AuditLog }  from '@/pages/AuditLog'
import { Team }      from '@/pages/Team'
import { Pipelines }      from '@/pages/Pipelines'
import { PublishHistory } from '@/pages/PublishHistory'
import { SocialAccounts }  from '@/pages/social/SocialAccounts'
import { SocialQueue }     from '@/pages/social/SocialQueue'
import { SocialAnalytics } from '@/pages/social/SocialAnalytics'
import { SocialTemplates } from '@/pages/social/SocialTemplates'
import { Login }     from '@/pages/Login'
import { Skeleton }  from '@/components/ui/skeleton'

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex h-screen items-center justify-center">
      <Skeleton className="h-8 w-48" />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index     element={<Dashboard />} />
        <Route path="sites"    element={<Sites />} />
        <Route path="sources"  element={<Sources />} />
        <Route path="posts"    element={<Posts />} />
        <Route path="settings"  element={<Settings />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="team"       element={<Team />} />
        <Route path="pipelines"     element={<Pipelines />} />
        <Route path="history"       element={<PublishHistory />} />
        <Route path="social/accounts"   element={<SocialAccounts />} />
        <Route path="social/queue"      element={<SocialQueue />} />
        <Route path="social/analytics"  element={<SocialAnalytics />} />
        <Route path="social/templates"  element={<SocialTemplates />} />
        <Route path="social" element={<Navigate to="/social/accounts" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <FetchProgressBar />
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
