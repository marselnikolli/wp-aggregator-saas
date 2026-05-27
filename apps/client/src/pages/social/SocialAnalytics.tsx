import { useQuery } from '@tanstack/react-query'
import { Share2, CheckCircle, XCircle, BarChart2 } from 'lucide-react'
import { socialApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

function StatCard({ title, value, icon: Icon, description }: {
  title: string; value: number | string; icon: React.ElementType; description?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  )
}

const TEMPLATE_LABELS: Record<string, string> = {
  photo_comment: 'Photo + comment',
  link_post:     'Link post',
  photo_only:    'Photo only',
  text_link:     'Text + link',
  image_overlay: 'Image overlay',
}

export function SocialAnalytics() {
  const { data, isLoading } = useQuery({
    queryKey: ['social-analytics'],
    queryFn:  socialApi.analytics,
    refetchInterval: 60_000,
  })

  const { data: topData, isLoading: topLoading } = useQuery({
    queryKey: ['social-analytics-top'],
    queryFn:  () => socialApi.history({ limit: 10, status: 'DONE' }),
  })

  if (isLoading) return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Social Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Engagement, reach and impressions across platforms</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  )

  const last30 = data?.last30Days ?? []
  const maxCount = Math.max(...last30.map((d: any) => d.count), 1)
  const byTemplate = data?.byTemplate ?? {}
  const fbCount = data?.byPlatform?.FACEBOOK ?? 0
  const igCount = data?.byPlatform?.INSTAGRAM ?? 0
  const total   = data?.total ?? 0
  const fbPct   = total > 0 ? Math.round((fbCount / total) * 100) : 0
  const igPct   = total > 0 ? Math.round((igCount / total) * 100) : 0

  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold">Social Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Engagement, reach and impressions across platforms</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Posts"  value={data?.total ?? 0}  icon={Share2}      description="All time" />
        <StatCard title="Published"    value={data?.done ?? 0}   icon={CheckCircle} description="Successfully posted" />
        <StatCard title="Failed"       value={data?.failed ?? 0} icon={XCircle}     description="Check queue for errors" />
        <StatCard title="Platforms"    value={`${fbCount}F / ${igCount}IG`} icon={BarChart2} description="Facebook / Instagram" />
      </div>

      {/* 30-day activity chart */}
      {last30.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Social Activity</CardTitle>
            <span className="text-xs text-muted-foreground">{data?.done ?? 0} posts · last 30 days</span>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-0.5 h-16">
              {last30.map((d: any) => (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end group relative"
                  title={`${d.date}: ${d.count} posts`}>
                  <div
                    className="w-full rounded-sm bg-primary/70 group-hover:bg-primary transition-colors"
                    style={{ height: `${Math.max((d.count / maxCount) * 100, d.count > 0 ? 8 : 2)}%` }}
                  />
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex bg-popover border border-border rounded px-1.5 py-0.5 text-xs whitespace-nowrap z-10 pointer-events-none">
                    {d.date.slice(5)}: {d.count}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>{last30[0]?.date?.slice(5)}</span>
              <span>today</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Platform breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By Platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-blue-500 font-medium">Facebook</span>
                <span className="text-muted-foreground">{fbCount} ({fbPct}%)</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${fbPct}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-pink-500 font-medium">Instagram</span>
                <span className="text-muted-foreground">{igCount} ({igPct}%)</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all" style={{ width: `${igPct}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Template breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By Template</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(byTemplate).length === 0 ? (
              <p className="text-sm text-muted-foreground">No data yet</p>
            ) : (
              Object.entries(byTemplate)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([key, count]) => {
                  const pct = total > 0 ? Math.round(((count as number) / total) * 100) : 0
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{TEMPLATE_LABELS[key] ?? key}</span>
                        <span className="text-muted-foreground">{count as number} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top posts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Posts</CardTitle>
        </CardHeader>
        <CardContent>
          {topLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : !topData?.items?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No published posts yet</p>
          ) : (
            <div className="space-y-2">
              {topData.items.map((post: any) => (
                <div key={post.id} className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-border/50 last:border-0">
                  <p className="truncate text-foreground flex-1">{post.post?.title ?? '—'}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${post.account?.platform === 'FACEBOOK' ? 'bg-blue-600 text-white' : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'}`}>
                      {post.account?.platform}
                    </span>
                    {post.engagement != null && (
                      <Badge variant="secondary" className="text-xs">{post.engagement} eng</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
