import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Toaster } from 'sonner'

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 min-h-0 flex-col">
          <Outlet />
        </div>
      </main>
      <Toaster theme="dark" richColors position="bottom-right" />
    </div>
  )
}
