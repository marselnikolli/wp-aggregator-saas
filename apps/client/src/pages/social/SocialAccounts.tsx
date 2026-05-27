import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Pencil, Loader2, Share2, RefreshCw,
  ChevronLeft, ChevronRight, AlertCircle, CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { socialApi, sitesApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'


// ─── Platform display ────────────────────────────────────────────────────────

type Platform = 'FACEBOOK' | 'INSTAGRAM'

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

// ─── Discovered page type ─────────────────────────────────────────────────────

interface DiscoveredPage {
  id:        string
  name:      string
  pageToken: string
  instagram: { id: string; username: string } | null
}

// ─── Add Account Wizard ───────────────────────────────────────────────────────

function AddAccountWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2>(1)

  // Step 1 state
  const [appId, setAppId]                     = useState('')
  const [appSecret, setAppSecret]             = useState('')
  const [shortLivedToken, setShortLivedToken] = useState('')
  const [fetchError, setFetchError]           = useState<string | null>(null)

  // Step 2 state
  const [userToken, setUserToken]             = useState('')
  const [pages, setPages]                     = useState<DiscoveredPage[]>([])
  const [selectedPageId, setSelectedPageId]   = useState('')
  const [createFacebook, setCreateFacebook]   = useState(true)
  const [createInstagram, setCreateInstagram] = useState(true)
  const [displayName, setDisplayName]         = useState('')
  const [rotationDays, setRotationDays]       = useState(50)
  const [siteId, setSiteId]                   = useState('')
  const [enabled, setEnabled]                 = useState(true)

  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })

  const selectedPage = pages.find(p => p.id === selectedPageId) ?? null

  const discover = useMutation({
    mutationFn: () => socialApi.discoverPages({ appId: appId.trim(), appSecret: appSecret.trim(), shortLivedToken: shortLivedToken.trim() }),
    onSuccess: (data: { userToken: string; pages: DiscoveredPage[] }) => {
      setFetchError(null)
      setUserToken(data.userToken)
      setPages(data.pages)
      const first = data.pages[0]
      setSelectedPageId(first?.id ?? '')
      setDisplayName(first?.name ?? '')
      setCreateInstagram(!!first?.instagram)
      setStep(2)
    },
    onError: (e: any) => {
      setFetchError(e.response?.data?.error ?? 'Failed to fetch pages. Check your credentials.')
    },
  })

  const save = useMutation({
    mutationFn: () => {
      if (!selectedPage) throw new Error('No page selected')
      return socialApi.createAccountBatch({
        appId:              appId.trim(),
        appSecret:          appSecret.trim(),
        longLivedUserToken: userToken,
        page:               { id: selectedPage.id, name: selectedPage.name, pageToken: selectedPage.pageToken },
        instagram:          selectedPage.instagram,
        name:               displayName.trim() || selectedPage.name,
        rotationDays,
        siteId:             siteId || null,
        enabled,
        createFacebook,
        createInstagram,
      })
    },
    onSuccess: (created: any[]) => {
      qc.invalidateQueries({ queryKey: ['social-accounts'] })
      toast.success(`${created.length} account${created.length > 1 ? 's' : ''} added`)
      handleClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to add accounts'),
  })

  function handleClose() {
    onClose()
    // reset after close animation
    setTimeout(() => {
      setStep(1)
      setAppId(''); setAppSecret(''); setShortLivedToken(''); setFetchError(null)
      setUserToken(''); setPages([]); setSelectedPageId(''); setDisplayName('')
      setCreateFacebook(true); setCreateInstagram(true)
      setRotationDays(50); setSiteId(''); setEnabled(true)
    }, 200)
  }

  function handlePageChange(pageId: string) {
    setSelectedPageId(pageId)
    const page = pages.find(p => p.id === pageId)
    if (page) {
      setDisplayName(page.name)
      setCreateInstagram(!!page.instagram)
    }
  }

  const canFetch  = appId.trim() && appSecret.trim() && shortLivedToken.trim()
  const canSave   = selectedPage && (createFacebook || (createInstagram && !!selectedPage.instagram)) && displayName.trim()

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 2 && (
              <button onClick={() => setStep(1)} className="text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {step === 1 ? 'Connect Social Accounts' : 'Configure Accounts'}
            <span className="ml-auto text-xs font-normal text-muted-foreground">Step {step} of 2</span>
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="grid gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              Enter your Facebook App credentials to auto-discover your Pages and Instagram accounts.{' '}
              <a
                href="https://developers.facebook.com/apps/"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                Get them here
              </a>
            </p>

            <div className="grid gap-1.5">
              <Label>App ID</Label>
              <Input
                placeholder="123456789012345"
                value={appId}
                onChange={e => setAppId(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label>App Secret</Label>
              <Input
                type="password"
                placeholder="••••••••••••••••"
                value={appSecret}
                onChange={e => setAppSecret(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label>
                Short-lived User Token{' '}
                <a
                  href="https://developers.facebook.com/tools/explorer/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-normal text-xs text-primary underline-offset-4 hover:underline"
                >
                  (get from Graph Explorer)
                </a>
              </Label>
              <textarea
                rows={3}
                placeholder="EAAxxxxxxxxxxxxxxxx…"
                value={shortLivedToken}
                onChange={e => setShortLivedToken(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Required permissions: <code className="text-xs">pages_manage_posts</code>,{' '}
                <code className="text-xs">pages_read_engagement</code>,{' '}
                <code className="text-xs">instagram_basic</code>
              </p>
            </div>

            {fetchError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{fetchError}</span>
              </div>
            )}
          </div>
        )}

        {step === 2 && selectedPage && (
          <div className="grid gap-4 py-2">
            {pages.length > 1 && (
              <div className="grid gap-1.5">
                <Label>Facebook Page</Label>
                <select
                  value={selectedPageId}
                  onChange={e => handlePageChange(e.target.value)}
                  className="h-9 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {pages.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-2">
              <Label>Accounts to create</Label>
              <div className="rounded-md border border-border divide-y divide-border">
                <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-secondary/50">
                  <input
                    type="checkbox"
                    checked={createFacebook}
                    onChange={e => setCreateFacebook(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <div className="flex items-center gap-2 min-w-0">
                    <PlatformBadge platform="FACEBOOK" />
                    <span className="text-sm truncate">{selectedPage.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">ID: {selectedPage.id}</span>
                  </div>
                </label>

                <label className={`flex items-center gap-3 px-3 py-2.5 ${selectedPage.instagram ? 'cursor-pointer hover:bg-secondary/50' : 'opacity-40 cursor-not-allowed'}`}>
                  <input
                    type="checkbox"
                    checked={createInstagram && !!selectedPage.instagram}
                    onChange={e => selectedPage.instagram && setCreateInstagram(e.target.checked)}
                    disabled={!selectedPage.instagram}
                    className="h-4 w-4 rounded border-border accent-primary disabled:opacity-50"
                  />
                  <div className="flex items-center gap-2 min-w-0">
                    <PlatformBadge platform="INSTAGRAM" />
                    {selectedPage.instagram ? (
                      <>
                        <span className="text-sm truncate">@{selectedPage.instagram.username}</span>
                        <span className="text-xs text-muted-foreground shrink-0">ID: {selectedPage.instagram.id}</span>
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">No Instagram connected to this page</span>
                    )}
                  </div>
                </label>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Display Name</Label>
              <Input
                placeholder={selectedPage.name}
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Token rotation</Label>
                <select
                  value={rotationDays}
                  onChange={e => setRotationDays(Number(e.target.value))}
                  className="h-9 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value={30}>Every 30 days</option>
                  <option value={45}>Every 45 days</option>
                  <option value={50}>Every 50 days</option>
                  <option value={60}>Every 60 days</option>
                </select>
              </div>

              <div className="grid gap-1.5">
                <Label>Linked Site <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <select
                  value={siteId}
                  onChange={e => setSiteId(e.target.value)}
                  className="h-9 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">None</option>
                  {(sites ?? []).map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>Enabled</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {step === 1 ? (
            <Button
              onClick={() => discover.mutate()}
              disabled={!canFetch || discover.isPending}
            >
              {discover.isPending && <Loader2 className="animate-spin" />}
              Fetch Pages
              {!discover.isPending && <ChevronRight className="h-4 w-4" />}
            </Button>
          ) : (
            <Button
              onClick={() => save.mutate()}
              disabled={!canSave || save.isPending}
            >
              {save.isPending && <Loader2 className="animate-spin" />}
              Add Account{createFacebook && createInstagram && selectedPage?.instagram ? 's' : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit Account Dialog ──────────────────────────────────────────────────────

function EditAccountDialog({
  open,
  onClose,
  account,
}: {
  open: boolean
  onClose: () => void
  account: any
}) {
  const qc = useQueryClient()
  const [name, setName]                 = useState(account.name ?? '')
  const [siteId, setSiteId]             = useState(account.siteId ?? '')
  const [enabled, setEnabled]           = useState(account.enabled ?? true)
  const [rotationDays, setRotationDays] = useState(account.rotationDays ?? 50)

  const { data: sites } = useQuery({ queryKey: ['sites'], queryFn: sitesApi.list })

  const save = useMutation({
    mutationFn: () => socialApi.updateAccount(account.id, {
      name: name.trim(),
      siteId: siteId || null,
      enabled,
      rotationDays,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-accounts'] })
      toast.success('Account updated')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Save failed'),
  })

  const rotate = useMutation({
    mutationFn: () => socialApi.rotateToken(account.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-accounts'] })
      toast.success('Token rotated successfully')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Rotation failed'),
  })

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Display Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label>Linked Site <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <select
              value={siteId}
              onChange={e => setSiteId(e.target.value)}
              className="h-9 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">None</option>
              {(sites ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {account.appId && (
            <div className="grid gap-1.5">
              <Label>Token rotation</Label>
              <select
                value={rotationDays}
                onChange={e => setRotationDays(Number(e.target.value))}
                className="h-9 rounded-md border border-border bg-secondary px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value={30}>Every 30 days</option>
                <option value={45}>Every 45 days</option>
                <option value={50}>Every 50 days</option>
                <option value={60}>Every 60 days</option>
              </select>
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label>Enabled</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {account.appId && (
            <div className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Rotate Token Now</p>
                <p className="text-xs text-muted-foreground">
                  {account.lastRotation
                    ? `Last rotated ${formatDistanceToNow(new Date(account.lastRotation), { addSuffix: true })}`
                    : 'Never rotated'}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => rotate.mutate()}
                disabled={rotate.isPending}
                className="h-8"
              >
                {rotate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Rotate
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Account Row ──────────────────────────────────────────────────────────────

function AccountRow({ account, onEdit }: { account: any; onEdit: (a: any) => void }) {
  const qc = useQueryClient()
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting]       = useState(false)

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => socialApi.updateAccount(account.id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['social-accounts'] }),
    onError:   (e: any) => toast.error(e.response?.data?.error ?? 'Update failed'),
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
              {account.appId && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <RefreshCw className="h-2.5 w-2.5" />
                  Auto-rotate
                </span>
              )}
              {account.siteId && (
                <Badge variant="outline" className="text-xs text-muted-foreground">linked</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Page ID: {account.pageId}
              {account.appId && account.lastRotation && (
                <> · rotated {formatDistanceToNow(new Date(account.lastRotation), { addSuffix: true })}</>
              )}
            </p>
            {testResult && (
              <p className={`text-xs mt-0.5 flex items-center gap-1 ${testResult.ok ? 'text-emerald-400' : 'text-destructive'}`}>
                {testResult.ok
                  ? <CheckCircle2 className="h-3 w-3" />
                  : <AlertCircle className="h-3 w-3" />}
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
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
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
            onClick={() => window.confirm(`Remove "${account.name}"?`) && remove.mutate()}
            disabled={remove.isPending}
          >
            {remove.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SocialAccounts() {
  const [addOpen, setAddOpen]       = useState(false)
  const [editTarget, setEditTarget] = useState<any>(null)

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['social-accounts'],
    queryFn:  socialApi.accounts,
  })

  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Social Accounts</h1>
          <p className="text-muted-foreground text-sm mt-1">Connected Facebook and Instagram accounts</p>
        </div>
        <Button onClick={() => setAddOpen(true)}><Plus />Add Account</Button>
      </div>

      <AddAccountWizard open={addOpen} onClose={() => setAddOpen(false)} />

      {editTarget && (
        <EditAccountDialog
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          account={editTarget}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : !accounts?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
            <Share2 className="h-10 w-10 opacity-30" />
            <p>No social accounts yet. Connect your first Facebook or Instagram page.</p>
            <Button variant="outline" onClick={() => setAddOpen(true)}><Plus />Add Account</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {accounts.map((account: any) => (
            <AccountRow key={account.id} account={account} onEdit={setEditTarget} />
          ))}
        </div>
      )}
    </div>
  )
}
