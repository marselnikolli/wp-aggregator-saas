import { useQuery } from '@tanstack/react-query'
import { Globe, Rss, Clock, CheckCircle, AlertCircle, Loader2, TrendingUp, ExternalLink } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { dashboardApi } from '@/lib/api'
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

function statusBadge(status: string) {
  if (status === 'OK')    return <Badge variant="success">OK</Badge>
  if (status === 'ERROR') return <Badge variant="destructive">Error</Badge>
  return <Badge variant="secondary">{status}</Badge>
}

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: dashboardApi.stats,
    refetchInterval: 30_000,
  })

  const { data: trendingData } = useQuery({
    queryKey: ['dashboard-trending'],
    queryFn: dashboardApi.trending,
    refetchInterval: 60_000,
  })

  if (isLoading) return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your aggregator</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  )

  return (
    <div className="space-y-6 p-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your aggregator activity</p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Sites"    value={data?.sites ?? 0}     icon={Globe}       description="WP targets" />
        <StatCard title="Sources"         value={data?.sources ?? 0}   icon={Rss}         description="Enabled feeds" />
        <StatCard title="Pending Review"  value={data?.pending ?? 0}   icon={Clock}       description="Awaiting approval" />
        <StatCard title="Published"       value={data?.published ?? 0} icon={CheckCircle} description="Total posts pushed" />
      </div>

      {/* Trending stories */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Trending</h2>
          <span className="text-xs text-muted-foreground">Stories covered by multiple sources in the last 7 days</span>
        </div>
        {!trendingData ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : trendingData.trending?.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <TrendingUp className="h-8 w-8 opacity-30" />
              <p className="text-sm">No trending stories yet — more sources + fetches will surface cross-source topics.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trendingData.trending.map((story: {
              id: string; title: string; count: number; latestAt: string
              imageUrl: string | null; originalUrl: string | null; sources: string[]
            }) => (
              <Card key={story.id} className="overflow-hidden hover:border-border/80 transition-colors">
                {story.imageUrl && (
                  <div className="h-32 w-full overflow-hidden bg-secondary">
                    <img src={story.imageUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <CardContent className={`p-3 space-y-2 ${!story.imageUrl ? 'pt-3' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug line-clamp-2 flex-1">{story.title}</p>
                    {story.originalUrl && (
                      <a href={story.originalUrl} target="_blank" rel="noopener noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-xs font-semibold text-primary">
                      {story.count} source{story.count !== 1 ? 's' : ''}
                    </Badge>
                    {story.sources.slice(0, 3).map(s => (
                      <span key={s} className="text-xs text-muted-foreground truncate max-w-[100px]">{s}</span>
                    ))}
                    {story.sources.length > 3 && (
                      <span className="text-xs text-muted-foreground">+{story.sources.length - 3} more</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(story.latestAt), { addSuffix: true })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recent fetch jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Fetch Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {!data?.recentJobs?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <AlertCircle className="h-8 w-8 opacity-40" />
              <p className="text-sm">No fetch jobs yet. Add a source and trigger a fetch.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.recentJobs.map((job: any) => (
                <div key={job.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    {job.status === 'PENDING' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : job.status === 'OK' ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-red-400" />
                    )}
                    <div>
                      <p className="text-sm font-medium">{job.source?.name ?? 'Unknown source'}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {job.status === 'OK' && (
                      <span className="text-xs text-muted-foreground">
                        {job.newPosts} new / {job.fetched} fetched
                      </span>
                    )}
                    {job.error && (
                      <span className="text-xs text-red-400 truncate max-w-[200px]">{job.error}</span>
                    )}
                    {statusBadge(job.status)}
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
