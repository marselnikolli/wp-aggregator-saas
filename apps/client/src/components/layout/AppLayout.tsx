import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Toaster } from 'sonner'

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-auto">
        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </main>
      <Toaster theme="dark" richColors position="bottom-right" />
    </div>
  )
}
