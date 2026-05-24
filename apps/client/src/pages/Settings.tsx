import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export function Settings() {
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
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label>OpenAI API Key</Label>
            <Input type="password" placeholder="sk-…" />
          </div>
          <div className="grid gap-1.5">
            <Label>Anthropic API Key</Label>
            <Input type="password" placeholder="sk-ant-…" />
          </div>
          <Button>Save AI Keys</Button>
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
            <Input type="number" defaultValue={60} min={5} className="w-32" />
          </div>
          <Button>Save Schedule</Button>
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
            <Button variant="destructive" size="sm">Clear</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
