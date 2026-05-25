import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Loader2, Trash2, X as XIcon, Plus, Download } from 'lucide-react'
import { settingsApi, sitesApi } from '@/lib/api'
import { Switch } from '@/components/ui/switch'

interface SettingsData {
  openaiKeySet:     boolean
  anthropicKeySet:  boolean
  fetchInterval:    number
  qualityThreshold: number
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
  const { data: webhookData } = useQuery<{ url: string }>({
    queryKey: ['webhook'],
    queryFn:  settingsApi.getWebhook,
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
        <p className="text-muted-foreground text-sm mt-1">Configure AI providers and defaults</p>
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
        </CardContent>
      </Card>

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

      <Separator />

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
