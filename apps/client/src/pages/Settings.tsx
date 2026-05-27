import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Loader2, Trash2, X as XIcon, Plus, Download, Monitor, ShieldCheck, Languages, Globe, HardDrive, Image, Rss, Copy, RefreshCw } from 'lucide-react'
import { settingsApi, sitesApi, authApi } from '@/lib/api'
import { Switch } from '@/components/ui/switch'

interface SettingsData {
  openaiKeySet:     boolean
  anthropicKeySet:  boolean
  fetchInterval:    number
  qualityThreshold: number
  translateTo:      string
}

function KeyRow({
  label,
  placeholder,
  isSet,
  provider,
  onSave,
  onRemove,
}: {
  label:       string
  placeholder: string
  isSet:       boolean
  provider:    'openai' | 'anthropic'
  onSave:      (key: string) => void
  onRemove:    () => void
}) {
  const [value, setValue] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error: string | null } | null>(null)

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await settingsApi.testAi(provider)
      setTestResult(result)
    } catch {
      setTestResult({ ok: false, error: 'Request failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {isSet && <Badge variant="secondary" className="text-xs h-5">Saved</Badge>}
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={isSet ? '••••••••••••  (enter new key to replace)' : placeholder}
          value={value}
          onChange={e => setValue(e.target.value)}
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          disabled={!value.trim()}
          onClick={() => { onSave(value.trim()); setValue('') }}
        >
          Save
        </Button>
        {isSet && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={testing}
              onClick={handleTest}
            >
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive px-2" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
      {testResult && (
        <p className={`text-xs flex items-center gap-1.5 ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
          {testResult.ok
            ? <><CheckCircle2 className="h-3.5 w-3.5" /> Connection successful</>
            : <><XCircle className="h-3.5 w-3.5" /> {testResult.error}</>
          }
        </p>
      )}
    </div>
  )
}

export function Settings() {
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery<SettingsData>({
    queryKey: ['settings'],
    queryFn:  settingsApi.get,
  })

  const [fetchInterval, setFetchInterval] = useState<number | ''>('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [showWebhookLog, setShowWebhookLog] = useState(false)
  const { data: webhookData } = useQuery<{ url: string }>({
    queryKey: ['webhook'],
    queryFn:  settingsApi.getWebhook,
  })
  const { data: webhookLogData } = useQuery<{ logs: any[] }>({
    queryKey: ['webhook-log'],
    queryFn:  settingsApi.getWebhookLog,
    enabled:  showWebhookLog,
    refetchInterval: showWebhookLog ? 15_000 : false,
  })
  const saveWebhook = useMutation({
    mutationFn: (url: string) => settingsApi.saveWebhook(url),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['webhook'] }); toast.success('Webhook saved') },
    onError:    () => toast.error('Failed to save webhook'),
  })

  const [qualityThreshold, setQualityThreshold] = useState<number | ''>('')
  const [blocklistInput, setBlocklistInput] = useState('')
  const [localBlocklist, setLocalBlocklist] = useState<string[] | null>(null)

  const { data: blocklistData } = useQuery<{ words: string[] }>({
    queryKey: ['blocklist'],
    queryFn:  settingsApi.getBlocklist,
  })
  const blocklist = localBlocklist ?? blocklistData?.words ?? []

  const saveBlocklist = useMutation({
    mutationFn: (words: string[]) => settingsApi.saveBlocklist(words),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['blocklist'] }); setLocalBlocklist(null); toast.success('Blocklist saved') },
    onError:    () => toast.error('Failed to save blocklist'),
  })

  function addBlockword() {
    const word = blocklistInput.trim().toLowerCase()
    if (!word || blocklist.includes(word)) { setBlocklistInput(''); return }
    setLocalBlocklist([...blocklist, word])
    setBlocklistInput('')
  }

  function removeBlockword(word: string) {
    setLocalBlocklist(blocklist.filter(w => w !== word))
  }

  const saveKeys = useMutation({
    mutationFn: (d: { openaiKey?: string; anthropicKey?: string }) => settingsApi.saveAiKeys(d),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('API key saved') },
    onError:    () => toast.error('Failed to save key'),
  })

  const saveSchedule = useMutation({
    mutationFn: (n: number) => settingsApi.saveSchedule(n),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Schedule saved') },
    onError:    () => toast.error('Failed to save schedule'),
  })

  const { data: sites } = useQuery<any[]>({ queryKey: ['sites'], queryFn: sitesApi.list })
  const { data: schedData } = useQuery({ queryKey: ['sched-publish'], queryFn: settingsApi.getScheduledPublish })
  const [sched, setSched] = useState<{ enabled: boolean; time: string; siteIds: string[]; maxPerRun: number; roundRobin: boolean } | null>(null)
  const schedValues = sched ?? { enabled: schedData?.enabled ?? false, time: schedData?.time ?? '08:00', siteIds: schedData?.siteIds ?? [], maxPerRun: schedData?.maxPerRun ?? 10, roundRobin: schedData?.roundRobin ?? false }
  const saveSched = useMutation({
    mutationFn: () => settingsApi.saveScheduledPublish(schedValues),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sched-publish'] }); setSched(null); toast.success('Scheduled publishing saved') },
    onError: () => toast.error('Failed to save'),
  })

  const { data: ipData } = useQuery({ queryKey: ['ip-allowlist'], queryFn: settingsApi.getIpAllowlist })
  const [ipInput, setIpInput] = useState('')
  const [localIps, setLocalIps] = useState<string[] | null>(null)
  const ips = localIps ?? ipData?.ips ?? []
  const saveIps = useMutation({
    mutationFn: () => settingsApi.saveIpAllowlist(ips),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ip-allowlist'] }); setLocalIps(null); toast.success('IP allowlist saved') },
    onError: () => toast.error('Failed to save'),
  })

  const [exporting, setExporting] = useState(false)

  // S3/R2 storage
  const { data: storageData } = useQuery({ queryKey: ['storage'], queryFn: settingsApi.getStorage })
  const [storageLocal, setStorageLocal] = useState<any>(null)
  const [storageTestResult, setStorageTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const storage = storageLocal ?? storageData ?? { endpoint: '', region: 'auto', accessKeySet: false, bucket: '', publicUrl: '' }
  const [storageKeys, setStorageKeys] = useState({ accessKey: '', secretKey: '' })
  const saveStorage = useMutation({
    mutationFn: () => settingsApi.saveStorage({
      endpoint:  storage.endpoint,
      region:    storage.region,
      bucket:    storage.bucket,
      publicUrl: storage.publicUrl,
      ...(storageKeys.accessKey ? { accessKey: storageKeys.accessKey } : {}),
      ...(storageKeys.secretKey ? { secretKey: storageKeys.secretKey } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['storage'] }); setStorageLocal(null); setStorageKeys({ accessKey: '', secretKey: '' }); toast.success('Storage settings saved') },
    onError:   () => toast.error('Failed to save storage settings'),
  })
  const [testingStorage, setTestingStorage] = useState(false)
  async function handleTestStorage() {
    setTestingStorage(true)
    setStorageTestResult(null)
    try { setStorageTestResult(await settingsApi.testStorage()) }
    catch { setStorageTestResult({ ok: false, error: 'Request failed' }) }
    finally { setTestingStorage(false) }
  }

  // Translation
  const [translateTo, setTranslateTo] = useState<string | null>(null)
  const translateValue = translateTo !== null ? translateTo : (settings?.translateTo ?? '')
  const saveTranslation = useMutation({
    mutationFn: () => settingsApi.saveTranslation(translateValue),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setTranslateTo(null); toast.success('Translation setting saved') },
    onError: () => toast.error('Failed to save'),
  })

  // Publish pipeline
  const { data: pipelineData } = useQuery({ queryKey: ['publish-pipeline'], queryFn: settingsApi.getPublishPipeline })
  const [pipelineLocal, setPipelineLocal] = useState<any>(null)
  const pipeline = pipelineLocal ?? pipelineData ?? { defaultStatus: 'publish', defaultSiteIds: [], notifications: { onError: false, dailyDigest: false, email: '' } }
  const savePipeline = useMutation({
    mutationFn: () => settingsApi.savePublishPipeline(pipeline),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['publish-pipeline'] }); setPipelineLocal(null); toast.success('Pipeline config saved') },
    onError: () => toast.error('Failed to save'),
  })

  // Sessions
  const { data: sessions, refetch: refetchSessions } = useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions })
  const revokeSession = useMutation({
    mutationFn: (jti: string) => authApi.revoke(jti),
    onSuccess: () => { refetchSessions(); toast.success('Session revoked') },
    onError: () => toast.error('Failed to revoke session'),
  })

  // 2FA TOTP
  const { data: meData, refetch: refetchMe } = useQuery({ queryKey: ['me'], queryFn: authApi.me })
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const setupTotp = useMutation({
    mutationFn: authApi.setupTotp,
    onSuccess: (d) => setTotpSetup(d),
    onError: () => toast.error('Failed to start 2FA setup'),
  })
  const enableTotp = useMutation({
    mutationFn: () => authApi.enableTotp(totpCode),
    onSuccess: () => { setTotpSetup(null); setTotpCode(''); refetchMe(); toast.success('2FA enabled') },
    onError: () => toast.error('Invalid code — try again'),
  })
  const disableTotp = useMutation({
    mutationFn: () => authApi.disableTotp(disableCode),
    onSuccess: () => { setDisableCode(''); refetchMe(); toast.success('2FA disabled') },
    onError: () => toast.error('Invalid code'),
  })

  async function handleImport(file: File) {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const result = await settingsApi.importData(data)
      qc.invalidateQueries({ queryKey: ['sources'] })
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success(`Restored ${result.sourcesRestored} sources, ${result.settingsRestored} settings`)
    } catch {
      toast.error('Import failed — check the file format')
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const blob = await settingsApi.exportData()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `wp-aggregator-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  const saveThreshold = useMutation({
    mutationFn: (n: number) => settingsApi.saveQualityThreshold(n),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Threshold saved') },
    onError:    () => toast.error('Failed to save threshold'),
  })

  const removeKey = useMutation({
    mutationFn: (provider: 'openai' | 'anthropic') => settingsApi.removeAiKey(provider),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['settings'] }); toast.success('Key removed') },
    onError:    () => toast.error('Failed to remove key'),
  })

  const { data: unsplashData, refetch: refetchUnsplash } = useQuery({ queryKey: ['unsplash-key'], queryFn: settingsApi.getUnsplashKey })
  const [unsplashInput, setUnsplashInput] = useState('')
  const saveUnsplashKey = useMutation({
    mutationFn: (key: string) => settingsApi.saveUnsplashKey(key),
    onSuccess: () => { refetchUnsplash(); setUnsplashInput(''); toast.success('Unsplash key saved') },
    onError: () => toast.error('Failed to save key'),
  })
  const removeUnsplashKey = useMutation({
    mutationFn: settingsApi.removeUnsplashKey,
    onSuccess: () => { refetchUnsplash(); toast.success('Unsplash key removed') },
  })

  const { data: feedData, refetch: refetchFeed } = useQuery({ queryKey: ['feed-token'], queryFn: settingsApi.getFeedToken })
  const regenFeedToken = useMutation({
    mutationFn: settingsApi.regenerateFeedToken,
    onSuccess: () => refetchFeed(),
  })
  const revokeFeedToken = useMutation({
    mutationFn: settingsApi.revokeFeedToken,
    onSuccess: () => { refetchFeed(); toast.success('Feed token revoked') },
  })

  const intervalValue = fetchInterval !== '' ? fetchInterval : (settings?.fetchInterval ?? 60)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl p-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex flex-wrap gap-2 mt-2">
          {[
            { id: 'ai', label: 'AI & Content' },
            { id: 'fetching', label: 'Sources & Fetching' },
            { id: 'publishing', label: 'Publishing' },
            { id: 'integrations', label: 'Integrations' },
            { id: 'security', label: 'Security' },
            { id: 'data', label: 'Data' },
          ].map(s => (
            <a key={s.id} href={`#${s.id}`}
              className="text-xs px-2.5 py-1 rounded-full bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors">
              {s.label}
            </a>
          ))}
        </div>
      </div>

      <div id="ai" className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI &amp; Content</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Summarization</CardTitle>
          <CardDescription>Keys are encrypted at rest with AES-256-CBC</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <KeyRow
            label="OpenAI API Key"
            placeholder="sk-…"
            provider="openai"
            isSet={settings?.openaiKeySet ?? false}
            onSave={key => saveKeys.mutate({ openaiKey: key })}
            onRemove={() => removeKey.mutate('openai')}
          />
          <KeyRow
            label="Anthropic API Key"
            placeholder="sk-ant-…"
            provider="anthropic"
            isSet={settings?.anthropicKeySet ?? false}
            onSave={key => saveKeys.mutate({ anthropicKey: key })}
            onRemove={() => removeKey.mutate('anthropic')}
          />
        </CardContent>
      </Card>

      <div id="fetching" className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources &amp; Fetching</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fetch Schedule</CardTitle>
          <CardDescription>How often to automatically fetch all enabled sources</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Interval (minutes)</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={5}
                max={1440}
                className="w-32"
                value={intervalValue}
                onChange={e => setFetchInterval(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <span className="text-sm text-muted-foreground">min 5, max 1440</span>
            </div>
          </div>
          <Button
            disabled={saveSchedule.isPending}
            onClick={() => saveSchedule.mutate(Number(intervalValue))}
          >
            {saveSchedule.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Schedule
          </Button>
        </CardContent>
      </Card>

      <div id="publishing" className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Publishing</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-Approve Pipeline</CardTitle>
          <CardDescription>
            Posts scoring ≥ threshold are automatically approved after fetch. Set to 0 to disable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Quality Score Threshold (0–100)</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={0}
                max={100}
                className="w-24"
                value={qualityThreshold !== '' ? qualityThreshold : (settings?.qualityThreshold ?? 0)}
                onChange={e => setQualityThreshold(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <span className="text-xs text-muted-foreground">
                Score based on: content length, image presence, title quality
              </span>
            </div>
          </div>
          <Button
            size="sm"
            disabled={saveThreshold.isPending}
            onClick={() => saveThreshold.mutate(Number(qualityThreshold !== '' ? qualityThreshold : (settings?.qualityThreshold ?? 0)))}
          >
            {saveThreshold.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Save Threshold
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-Reject Blocklist</CardTitle>
          <CardDescription>Posts matching any keyword (title or content) are automatically rejected on fetch</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Add keyword…"
              value={blocklistInput}
              className="text-sm"
              onChange={e => setBlocklistInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addBlockword()}
            />
            <Button size="sm" variant="outline" onClick={addBlockword} disabled={!blocklistInput.trim()}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
          {blocklist.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {blocklist.map(word => (
                <span key={word} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
                  {word}
                  <button onClick={() => removeBlockword(word)} className="text-muted-foreground hover:text-foreground">
                    <XIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Button
            size="sm"
            disabled={saveBlocklist.isPending || localBlocklist === null}
            onClick={() => saveBlocklist.mutate(blocklist)}
          >
            {saveBlocklist.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Save Blocklist
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduled Publishing</CardTitle>
          <CardDescription>Auto-publish approved posts to selected sites at a set time each day</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between">
            <span className="text-sm font-medium">Enable scheduled publishing</span>
            <Switch checked={schedValues.enabled} onCheckedChange={v => setSched(s => ({ ...schedValues, ...s, enabled: v }))} />
          </label>
          {schedValues.enabled && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Publish time (local 24h)</Label>
                  <Input type="time" className="w-32 text-sm" value={schedValues.time}
                    onChange={e => setSched(s => ({ ...schedValues, ...s, time: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Max posts per run</Label>
                  <Input type="number" min={1} max={200} className="w-24 text-sm" value={schedValues.maxPerRun}
                    onChange={e => setSched(s => ({ ...schedValues, ...s, maxPerRun: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Target sites</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(sites ?? []).map((site: any) => {
                    const active = schedValues.siteIds.includes(site.id)
                    return (
                      <button key={site.id} type="button"
                        onClick={() => setSched(s => ({ ...schedValues, ...s, siteIds: active ? schedValues.siteIds.filter((id: string) => id !== site.id) : [...schedValues.siteIds, site.id] }))}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${active ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:border-foreground/40'}`}>
                        {site.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              <label className="flex items-center justify-between rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-secondary/50">
                <div>
                  <p className="text-sm font-medium">Round-robin mode</p>
                  <p className="text-xs text-muted-foreground">Each post goes to one site, rotating evenly. Off = publish each post to all selected sites</p>
                </div>
                <Switch checked={schedValues.roundRobin} onCheckedChange={v => setSched(s => ({ ...schedValues, ...s, roundRobin: v }))} />
              </label>
            </>
          )}
          <Button size="sm" disabled={saveSched.isPending} onClick={() => saveSched.mutate()}>
            {saveSched.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Save Schedule
          </Button>
        </CardContent>
      </Card>

      <div id="integrations" className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Integrations</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook Outbound</CardTitle>
          <CardDescription>POST to this URL when a new post is fetched. Payload: <code className="text-xs">{"{ event, post: { id, title, originalUrl } }"}</code></CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="https://your-service.com/webhook"
              value={webhookUrl !== '' ? webhookUrl : (webhookData?.url ?? '')}
              onChange={e => setWebhookUrl(e.target.value)}
              className="text-sm font-mono"
            />
            <Button
              size="sm"
              disabled={saveWebhook.isPending}
              onClick={() => saveWebhook.mutate(webhookUrl !== '' ? webhookUrl : (webhookData?.url ?? ''))}
            >
              {saveWebhook.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
            {webhookData?.url && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setWebhookUrl(''); saveWebhook.mutate('') }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setShowWebhookLog(v => !v)}
          >
            {showWebhookLog ? '▲' : '▼'} Recent deliveries
          </button>
          {showWebhookLog && (
            <div className="rounded-md border border-border/60 overflow-hidden">
              {!webhookLogData?.logs?.length ? (
                <p className="text-xs text-muted-foreground p-3">No deliveries recorded yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {webhookLogData.logs.map((log: any) => (
                    <div key={log.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 shrink-0">
                        {log.success
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          : <XCircle className="h-3.5 w-3.5 text-red-400" />}
                        <Badge variant={log.success ? 'success' : 'destructive'} className="text-[10px] px-1.5">
                          {log.statusCode ?? 'ERR'}
                        </Badge>
                        <span className="text-muted-foreground">{log.durationMs}ms</span>
                      </div>
                      <span className="text-muted-foreground truncate flex-1">{log.responseBody?.slice(0, 80) ?? '—'}</span>
                      <span className="text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div id="data" className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Data</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Export</CardTitle>
          <CardDescription>Download all sources, posts, and non-sensitive settings as JSON</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button variant="outline" disabled={exporting} onClick={handleExport}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              Export JSON
            </Button>
            <label>
              <Button variant="outline" asChild>
                <span className="cursor-pointer">Import JSON</span>
              </Button>
              <input
                type="file"
                accept=".json"
                className="hidden"
                ref={_el => {}}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = '' }}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <div id="security" className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Security</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">IP Allowlist</CardTitle>
          <CardDescription>Restrict API access to specific IP addresses. Leave empty to allow all IPs. Your current IP will be auto-included when you save a non-empty list.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="e.g. 203.0.113.42" value={ipInput} className="text-sm font-mono"
              onChange={e => setIpInput(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return
                const ip = ipInput.trim()
                if (ip && !ips.includes(ip)) setLocalIps([...ips, ip])
                setIpInput('')
              }} />
            <Button size="sm" variant="outline" disabled={!ipInput.trim()} onClick={() => {
              const ip = ipInput.trim()
              if (ip && !ips.includes(ip)) setLocalIps([...ips, ip])
              setIpInput('')
            }}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
          {ips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ips.map((ip: string) => (
                <span key={ip} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-mono">
                  {ip}
                  <button onClick={() => setLocalIps(ips.filter((x: string) => x !== ip))} className="text-muted-foreground hover:text-foreground">
                    <XIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {ips.length === 0 && <p className="text-xs text-muted-foreground">No IP restrictions — all IPs allowed.</p>}
          <Button size="sm" disabled={saveIps.isPending || localIps === null} onClick={() => saveIps.mutate()}>
            {saveIps.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Save Allowlist
          </Button>
        </CardContent>
      </Card>

      {/* S3/R2 Image Storage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><HardDrive className="h-4 w-4" />Image Storage (S3 / R2)</CardTitle>
          <CardDescription>Re-host images in your own S3-compatible bucket. Cloudflare R2 is recommended (no egress fees). Leave blank to use original image URLs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Endpoint URL</Label>
              <Input placeholder="https://s3.amazonaws.com or R2 endpoint" value={storage.endpoint}
                onChange={e => setStorageLocal((p: any) => ({ ...storage, ...p, endpoint: e.target.value }))} className="text-sm font-mono" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Region</Label>
              <Input placeholder="auto (R2) or us-east-1" value={storage.region}
                onChange={e => setStorageLocal((p: any) => ({ ...storage, ...p, region: e.target.value }))} className="text-sm font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Access Key ID</Label>
              <Input type="password" placeholder={storage.accessKeySet ? '•••••• (enter to replace)' : 'Access key…'}
                value={storageKeys.accessKey} onChange={e => setStorageKeys(p => ({ ...p, accessKey: e.target.value }))} className="text-sm font-mono" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Secret Access Key</Label>
              <Input type="password" placeholder="Secret key…"
                value={storageKeys.secretKey} onChange={e => setStorageKeys(p => ({ ...p, secretKey: e.target.value }))} className="text-sm font-mono" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Bucket Name</Label>
              <Input placeholder="my-images-bucket" value={storage.bucket}
                onChange={e => setStorageLocal((p: any) => ({ ...storage, ...p, bucket: e.target.value }))} className="text-sm font-mono" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Public URL prefix <span className="text-muted-foreground">(optional)</span></Label>
              <Input placeholder="https://images.example.com" value={storage.publicUrl}
                onChange={e => setStorageLocal((p: any) => ({ ...storage, ...p, publicUrl: e.target.value }))} className="text-sm font-mono" />
            </div>
          </div>
          {storageTestResult && (
            <p className={`text-xs flex items-center gap-1.5 ${storageTestResult.ok ? 'text-green-600' : 'text-destructive'}`}>
              {storageTestResult.ok
                ? <><CheckCircle2 className="h-3.5 w-3.5" /> Connection successful</>
                : <><XCircle className="h-3.5 w-3.5" /> {storageTestResult.error}</>
              }
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={saveStorage.isPending || storageLocal === null} onClick={() => saveStorage.mutate()}>
              {saveStorage.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Save
            </Button>
            <Button size="sm" variant="outline" disabled={testingStorage || !storageData?.bucket} onClick={handleTestStorage}>
              {testingStorage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test connection'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI Translation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Languages className="h-4 w-4" />AI Translation</CardTitle>
          <CardDescription>Automatically translate fetched content to a target language using the configured AI provider</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5">
            <Label>Translate to language</Label>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. English, Albanian, Spanish… (leave blank to disable)"
                value={translateValue}
                onChange={e => setTranslateTo(e.target.value)}
                className="text-sm"
              />
              <Button size="sm" disabled={saveTranslation.isPending || translateTo === null} onClick={() => saveTranslation.mutate()}>
                {saveTranslation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </Button>
              {translateValue && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setTranslateTo(''); saveTranslation.mutate() }}>
                  <XIcon className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Only posts where the detected language differs from the target are translated. The AI-rewritten title and summary are stored as translated versions.</p>
        </CardContent>
      </Card>

      {/* Default Publishing Pipeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Globe className="h-4 w-4" />Default Publishing Pipeline</CardTitle>
          <CardDescription>Default post status and target sites when manually publishing. Also configure notification preferences.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">Default post status</Label>
            <div className="flex gap-2">
              {(['publish', 'draft'] as const).map(s => (
                <button key={s} type="button"
                  onClick={() => setPipelineLocal((p: any) => ({ ...pipeline, ...p, defaultStatus: s }))}
                  className={`flex-1 rounded-md border py-2 px-3 text-sm font-medium transition-colors ${pipeline.defaultStatus === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-foreground/40'}`}>
                  {s === 'publish' ? 'Publish immediately' : 'Save as draft'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Default target sites</Label>
            <div className="flex flex-wrap gap-1.5">
              {(sites ?? []).map((site: any) => {
                const active = pipeline.defaultSiteIds.includes(site.id)
                return (
                  <button key={site.id} type="button"
                    onClick={() => setPipelineLocal((p: any) => ({
                      ...pipeline, ...p,
                      defaultSiteIds: active
                        ? pipeline.defaultSiteIds.filter((id: string) => id !== site.id)
                        : [...pipeline.defaultSiteIds, site.id],
                    }))}
                    className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${active ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:border-foreground/40'}`}>
                    {site.name}
                  </button>
                )
              })}
              {!(sites ?? []).length && <p className="text-xs text-muted-foreground">No sites configured yet</p>}
            </div>
          </div>
          <Separator />
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Notifications</Label>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium">Email on fetch error</p>
                <p className="text-xs text-muted-foreground">Send an email when a source repeatedly fails</p>
              </div>
              <Switch checked={pipeline.notifications.onError}
                onCheckedChange={v => setPipelineLocal((p: any) => ({ ...pipeline, ...p, notifications: { ...pipeline.notifications, onError: v } }))} />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium">Daily digest email</p>
                <p className="text-xs text-muted-foreground">Summary of new posts, publish stats, and errors each morning</p>
              </div>
              <Switch checked={pipeline.notifications.dailyDigest}
                onCheckedChange={v => setPipelineLocal((p: any) => ({ ...pipeline, ...p, notifications: { ...pipeline.notifications, dailyDigest: v } }))} />
            </label>
            {(pipeline.notifications.onError || pipeline.notifications.dailyDigest) && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Notification email</Label>
                <Input type="email" placeholder="you@example.com" value={pipeline.notifications.email} className="text-sm"
                  onChange={e => setPipelineLocal((p: any) => ({ ...pipeline, ...p, notifications: { ...pipeline.notifications, email: e.target.value } }))} />
              </div>
            )}
          </div>
          <Button size="sm" disabled={savePipeline.isPending || pipelineLocal === null} onClick={() => savePipeline.mutate()}>
            {savePipeline.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Save Pipeline Config
          </Button>
        </CardContent>
      </Card>

      {/* Session Management */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Monitor className="h-4 w-4" />Active Sessions</CardTitle>
          <CardDescription>Review and revoke active login sessions for your account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!sessions?.length && <p className="text-sm text-muted-foreground">No active sessions found.</p>}
          {sessions?.map((s: any) => (
            <div key={s.jti} className="flex items-start justify-between rounded-md border border-border px-3 py-2.5 gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-mono truncate">{s.ua ? s.ua.slice(0, 50) + (s.ua.length > 50 ? '…' : '') : 'Unknown client'}</p>
                  {s.current && <Badge variant="secondary" className="text-xs shrink-0">Current</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  IP: {s.ip || 'unknown'} · Expires {s.expiresIn > 0 ? `in ${Math.round(s.expiresIn / 3600)}h` : 'soon'}
                </p>
              </div>
              {!s.current && (
                <Button size="sm" variant="ghost" className="text-destructive shrink-0"
                  disabled={revokeSession.isPending}
                  onClick={() => revokeSession.mutate(s.jti)}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Two-Factor Authentication */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Two-Factor Authentication (TOTP)</CardTitle>
          <CardDescription>
            {meData?.totpEnabled ? '2FA is enabled. Use your authenticator app to generate codes.' : 'Add an extra layer of security to your account.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {meData?.totpEnabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" /> 2FA is active
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Enter code to disable</Label>
                <div className="flex gap-2">
                  <Input type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={disableCode}
                    onChange={e => setDisableCode(e.target.value.replace(/\D/g, ''))} className="w-32 font-mono text-sm tracking-widest" />
                  <Button size="sm" variant="destructive" disabled={disableCode.length !== 6 || disableTotp.isPending}
                    onClick={() => disableTotp.mutate()}>
                    {disableTotp.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Disable 2FA'}
                  </Button>
                </div>
              </div>
            </div>
          ) : totpSetup ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Scan this QR code with your authenticator app</p>
                <img src={totpSetup.qrDataUrl} alt="QR code" className="w-44 h-44 rounded-md border border-border" />
                <p className="text-xs text-muted-foreground">Or enter the secret manually:</p>
                <p className="font-mono text-xs break-all bg-secondary rounded px-2 py-1">{totpSetup.secret}</p>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Verify — enter the 6-digit code from your app</Label>
                <div className="flex gap-2">
                  <Input type="text" inputMode="numeric" maxLength={6} placeholder="000000" value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))} className="w-32 font-mono text-sm tracking-widest" />
                  <Button size="sm" disabled={totpCode.length !== 6 || enableTotp.isPending} onClick={() => enableTotp.mutate()}>
                    {enableTotp.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Verify & Enable'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setTotpSetup(null); setTotpCode('') }}>Cancel</Button>
                </div>
              </div>
            </div>
          ) : (
            <Button size="sm" disabled={setupTotp.isPending} onClick={() => setupTotp.mutate()}>
              {setupTotp.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
              Set up 2FA
            </Button>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Image className="h-4 w-4" />Unsplash Image Fallback</CardTitle>
          <CardDescription>When a post has no featured image, search Unsplash automatically</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5">
            <Label>Unsplash Access Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={unsplashData?.isSet ? '••••••••  (enter new key to replace)' : 'Your Unsplash Access Key'}
                value={unsplashInput}
                onChange={e => setUnsplashInput(e.target.value)}
                className="font-mono text-sm"
              />
              <Button size="sm" disabled={!unsplashInput.trim() || saveUnsplashKey.isPending}
                onClick={() => saveUnsplashKey.mutate(unsplashInput.trim())}>
                {saveUnsplashKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </Button>
              {unsplashData?.isSet && (
                <Button size="sm" variant="ghost" className="text-destructive px-2"
                  onClick={() => removeUnsplashKey.mutate(undefined)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Create a free app at unsplash.com/developers to get an access key.
              {unsplashData?.isSet && <span className="text-emerald-400 ml-1">● Active</span>}
            </p>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Rss className="h-4 w-4" />RSS Feed</CardTitle>
          <CardDescription>Subscribe to published posts via RSS — no login required</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {feedData?.token ? (
            <>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-secondary px-3 py-2 text-xs font-mono truncate select-all">
                  {`${window.location.origin}/api/feed/${feedData.token}.rss`}
                </code>
                <Button size="sm" variant="outline" onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/api/feed/${feedData.token}.rss`)
                  toast.success('Feed URL copied')
                }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => regenFeedToken.mutate()} disabled={regenFeedToken.isPending}>
                  {regenFeedToken.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Regenerate
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revokeFeedToken.mutate()} disabled={revokeFeedToken.isPending}>
                  Revoke
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No feed token yet. Generate one to enable the RSS feed.</p>
              <Button size="sm" onClick={() => regenFeedToken.mutate()} disabled={regenFeedToken.isPending}>
                {regenFeedToken.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rss className="h-3.5 w-3.5" />}
                Generate Feed Token
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <div className="flex items-center gap-3 pt-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-destructive/70">Danger Zone</span>
        <div className="flex-1 h-px bg-destructive/20" />
      </div>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Clear all cached posts</p>
              <p className="text-xs text-muted-foreground">Removes all aggregated posts not yet published</p>
            </div>
            <Button variant="destructive" size="sm" onClick={async () => {
              if (!confirm('Delete all unpublished posts? This cannot be undone.')) return
              try {
                await settingsApi.exportData() // export first as safety net
              } catch { /* non-fatal */ }
              toast.error('Not yet implemented — export your data first')
            }}>Clear</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
