import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2, Copy, Check, Users, Key } from 'lucide-react'
import { toast } from 'sonner'
import { usersApi, apiKeysApi, authApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

const ROLE_COLORS: Record<string, string> = {
  admin:  'bg-red-100 text-red-800',
  editor: 'bg-blue-100 text-blue-800',
  viewer: 'bg-gray-100 text-gray-700',
}

function NewUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'editor' as 'admin' | 'editor' | 'viewer' })

  const create = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User created'); onClose(); setForm({ email: '', password: '', name: '', role: 'editor' }) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to create user'),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>New User</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5"><Label>Email</Label>
            <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
          <div className="grid gap-1.5"><Label>Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div className="grid gap-1.5"><Label>Password</Label>
            <Input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} /></div>
          <div className="grid gap-1.5"><Label>Role</Label>
            <div className="flex gap-2">
              {(['admin', 'editor', 'viewer'] as const).map(r => (
                <button key={r} onClick={() => setForm(p => ({ ...p, role: r }))}
                  className={`flex-1 rounded-md border py-2 text-sm capitalize transition-colors ${form.role === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
                  {r}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Admin: full access · Editor: approve/publish, no settings · Viewer: read-only
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !form.email || !form.password}>
            {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApiKeyRevealDialog({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Your new API key</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">Copy this now — it won't be shown again.</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 rounded-md bg-secondary px-3 py-2 text-xs font-mono break-all">{apiKey}</code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Use as: <code className="bg-secondary px-1 rounded">Authorization: Bearer {apiKey.slice(0, 16)}…</code></p>
        </div>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Team() {
  const qc = useQueryClient()
  const [showNewUser, setShowNewUser] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [revealKey, setRevealKey] = useState<string | null>(null)

  const { data: users    = [], isLoading: loadingUsers } = useQuery({ queryKey: ['users'],    queryFn: usersApi.list })
  const { data: keys     = [], isLoading: loadingKeys  } = useQuery({ queryKey: ['api-keys'], queryFn: apiKeysApi.list })
  useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions })

  const deleteUser = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User deleted') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed'),
  })

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => usersApi.update(id, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Role updated') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed'),
  })

  const createKey = useMutation({
    mutationFn: () => apiKeysApi.create(newKeyName),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['api-keys'] })
      setNewKeyName('')
      setRevealKey(d.key)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed'),
  })

  const deleteKey = useMutation({
    mutationFn: (id: string) => apiKeysApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast.success('Key revoked') },
    onError: () => toast.error('Failed to revoke key'),
  })

  return (
    <div className="space-y-6 max-w-2xl p-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold">Team & Access</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage users, roles, and API keys</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Users</CardTitle>
            <CardDescription>Role-based access control</CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowNewUser(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add User</Button>
        </CardHeader>
        <CardContent>
          {loadingUsers ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
            <div className="space-y-2">
              {(users as any[]).map(u => (
                <div key={u.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.name ?? u.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <select
                    value={u.role}
                    onChange={e => changeRole.mutate({ id: u.id, role: e.target.value })}
                    className="h-7 rounded border border-border bg-background px-2 text-xs focus:outline-none">
                    <option value="admin">admin</option>
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_COLORS[u.role] ?? ''}`}>{u.role}</span>
                  <Button size="sm" variant="ghost" className="text-destructive px-2 h-7"
                    onClick={() => { if (confirm(`Delete ${u.email}?`)) deleteUser.mutate(u.id) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Key className="h-4 w-4" />API Keys</CardTitle>
          <CardDescription>Use API keys instead of passwords for programmatic access. Keys have the same permissions as the generating user.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input placeholder="Key name (e.g. CI pipeline)" className="text-sm" value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newKeyName.trim() && createKey.mutate()} />
            <Button size="sm" disabled={!newKeyName.trim() || createKey.isPending} onClick={() => createKey.mutate()}>
              {createKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Generate
            </Button>
          </div>
          {loadingKeys ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
            <div className="space-y-2">
              {(keys as any[]).length === 0 && <p className="text-sm text-muted-foreground">No API keys yet.</p>}
              {(keys as any[]).map(k => (
                <div key={k.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{k.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(k.createdAt).toLocaleDateString()}
                      {k.lastUsed && ` · Last used ${new Date(k.lastUsed).toLocaleDateString()}`}
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">wpa_…</Badge>
                  <Button size="sm" variant="ghost" className="text-destructive px-2 h-7"
                    onClick={() => { if (confirm(`Revoke "${k.name}"?`)) deleteKey.mutate(k.id) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NewUserDialog open={showNewUser} onClose={() => setShowNewUser(false)} />
      {revealKey && <ApiKeyRevealDialog apiKey={revealKey} onClose={() => setRevealKey(null)} />}
    </div>
  )
}
