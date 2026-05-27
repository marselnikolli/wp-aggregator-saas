import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Loader2, Share2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { socialApi, sitesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

const PLATFORMS = ['FACEBOOK', 'INSTAGRAM'] as const
type Platform = typeof PLATFORMS[number]

const PLATFORM_STYLE: Record<Platform, { label: string; className: string }> = {
  FACEBOOK:  { label: 'Facebook',  className: 'bg-blue-600 text-white border-blue-700' },
  INSTAGRAM: { label: 'Instagram', className: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400 text-white border-transparent' },
}

function PlatformBadge({ platform }: { platform: Platform }) {
  const s = PLATFORM_STYLE[platform] ?? PLATFORM_STYLE.FACEBOOK
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  )
}

interface AccountFormState {
  platform:    Platform
  name:        string
  pageId:      string
  accessToken: string
  siteId:      string
  enabled:     boolean
}

const BLANK_FORM: AccountFormState = {
  platform:    'FACEBOOK',
  name:        '',
  pageId:      '',
  accessToken: '',
  siteId:      '',
  enabled:     true,
}

function AccountDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean
  onClose: () => void
  existing: any | null
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<AccountFormState>(
    existing
      ? {
          platform:    existing.platform ?? 'FACEBOOK',
          name:        existing.name ?? '',
          pageId:      existing.pageId ?? '',
          accessToken: '',
          siteId:      existing.siteId ?? '',
          enabled:     existing.enabled ?? true,
        }
      : BLANK_FORM,
  )
  const [showToken, setShowToken] = useState(false)

  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })

  const set = (key: keyof AccountFormState, value: any) =>
    setForm(p => ({ ...p, [key]: value }))

  const save = useMutation({
    mutationFn: () => {
      const body: any = {
        platform:    form.platform,
        name:        form.name,
        pageId:      form.pageId,
        siteId:      form.siteId || null,
        enabled:     form.enabled,
      }
      if (form.accessToken) body.accessToken = form.accessToken
      return existing
        ? socialApi.updateAccount(existing.id, body)
        : socialApi.createAccount(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-accounts'] })
      toast.success(existing ? 'Account updated' : 'Account added')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Save failed'),
  })

  const canSave = form.name.trim() && form.pageId.trim() && (!existing ? !!form.accessToken.trim() : true)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit Account' : 'Add Social Account'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Platform</Label>
            <div className="flex gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set('platform', p)}
                  className={`flex-1 rounded-md border py-1.5 text-sm transition-colors ${
                    form.platform === p
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {PLATFORM_STYLE[p].label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Display Name</Label>
            <Input
              placeholder="My Facebook Page"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Page ID</Label>
            <Input
              placeholder="123456789012345"
              value={form.pageId}
              onChange={e => set('pageId', e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>
              Access Token
              {existing && (
                <span className="ml-1 font-normal text-muted-foreground text-xs">(leave blank to keep existing)</span>
              )}
            </Label>
            <div className="relative">
              <textarea
                rows={3}
                placeholder="EAAxxxxxxxxxxxxxxxx…"
                value={form.accessToken}
                onChange={e => set('accessToken', e.target.value)}
                className={`w-full rounded-md border border-border bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground ${showToken ? '' : '[&]:text-security-disc'}`}
                style={showToken ? {} : { WebkitTextSecurity: 'disc' } as any}
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>
              Linked Site <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <select
              value={form.siteId}
              onChange={e => set('siteId', e.target.value)}
              className="h-9 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">None</option>
              {(sites ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label>Enabled</Label>
            <Switch checked={form.enabled} onCheckedChange={v => set('enabled', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {existing ? 'Save' : 'Add Account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccountRow({
  account,
  onEdit,
}: {
  account: any
  onEdit: (a: any) => void
}) {
  const qc = useQueryClient()
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => socialApi.updateAccount(account.id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social-accounts'] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Update failed'),
  })

  const remove = useMutation({
    mutationFn: () => socialApi.deleteAccount(account.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-accounts'] })
      toast.success('Account removed')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Delete failed'),
  })

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await socialApi.testAccount(account.id)
      setTestResult({ ok: true, message: res.name ? `Connected as ${res.name}` : 'Connected' })
    } catch (e: any) {
      setTestResult({ ok: false, message: e.response?.data?.error ?? 'Failed' })
    } finally {
      setTesting(false)
    }
  }

  function handleDelete() {
    if (!window.confirm(`Remove "${account.name}"?`)) return
    remove.mutate()
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary shrink-0">
            <Share2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">{account.name}</p>
              <PlatformBadge platform={account.platform} />
              {account.siteId && (
                <Badge variant="outline" className="text-xs text-muted-foreground">linked</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Page ID: {account.pageId}</p>
            {testResult && (
              <p className={`text-xs mt-0.5 ${testResult.ok ? 'text-emerald-400' : 'text-destructive'}`}>
                {testResult.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-3">
          <Switch
            checked={account.enabled}
            onCheckedChange={(v) => toggle.mutate(v)}
            disabled={toggle.isPending}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={testing}
            className="h-8"
          >
            {testing ? <Loader2 className="animate-spin" /> : null}
            Test
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(account)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={remove.isPending}
          >
            {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function SocialAccounts() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['social-accounts'],
    queryFn:  socialApi.accounts,
  })

  function openAdd() {
    setEditTarget(null)
    setDialogOpen(true)
  }

  function openEdit(account: any) {
    setEditTarget(account)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditTarget(null)
  }

  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Social Accounts</h1>
          <p className="text-muted-foreground text-sm mt-1">Connected Facebook and Instagram accounts</p>
        </div>
        <Button onClick={openAdd}><Plus />Add Account</Button>
      </div>

      <AccountDialog open={dialogOpen} onClose={closeDialog} existing={editTarget} />

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : !accounts?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Share2 className="h-10 w-10 opacity-30" />
            <p>No social accounts yet. Connect your first Facebook or Instagram page.</p>
            <Button variant="outline" onClick={openAdd}><Plus />Add Account</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {accounts.map((account: any) => (
            <AccountRow key={account.id} account={account} onEdit={openEdit} />
          ))}
        </div>
      )}
    </div>
  )
}
