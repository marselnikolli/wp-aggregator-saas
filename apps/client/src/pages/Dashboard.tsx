import { useQuery } from '@tanstack/react-query'
import { Globe, Rss, Clock, CheckCircle, AlertCircle, Loader2, TrendingUp } from 'lucide-react'
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

      {/* Trending topics */}
      {trendingData?.trending?.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Trending Topics</CardTitle>
            <span className="text-xs text-muted-foreground ml-auto">Last 7 days · same story across sources</span>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {trendingData.trending.map((topic: { id: string; title: string; count: number }) => (
                <div key={topic.id}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-3 py-1 text-sm">
                  <span className="truncate max-w-[260px]">{topic.title}</span>
                  <span className="rounded-full bg-primary/20 text-primary text-xs font-semibold px-1.5 py-0.5">
                    ×{topic.count}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
