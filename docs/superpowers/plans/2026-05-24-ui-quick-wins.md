# UI Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add bulk post actions, inline post editor, keyboard shortcuts (Phase 1), then SSE fetch progress per source and a sidebar queue status panel (Phase 2).

**Architecture:** Phase 1 is pure client-side except for one new `PATCH /posts/:id` endpoint. Phase 2 adds a Fastify SSE stream wired to BullMQ QueueEvents, and a queue-stats endpoint polled by the sidebar.

**Tech Stack:** Fastify, BullMQ QueueEvents, React, TanStack Query, lucide-react.

---

## Task 1 — Backend: PATCH /posts/:id

Modify `apps/server/src/routes/posts.ts`. Add before the delete route:

```typescript
app.patch('/posts/:id', { preHandler: [app.authenticate] }, async (req) => {
  const { id } = req.params as { id: string }
  const body = z.object({
    title:   z.string().min(1).optional(),
    excerpt: z.string().optional(),
    content: z.string().optional(),
  }).parse(req.body)
  return db.aggregatedPost.update({ where: { id }, data: body })
})
```

Commit: `feat: add PATCH /posts/:id for field updates`

---

## Task 2 — API client helpers

Modify `apps/client/src/lib/api.ts`.

Add to `postsApi`: `update: (id: string, d: any) => api.patch('/posts/${id}', d).then(r => r.data)`

Add to `dashboardApi`: `queues: () => api.get('/dashboard/queues').then(r => r.data)`

Commit: `feat: add postsApi.update and dashboardApi.queues`

---

## Task 3 — Posts.tsx rewrite (bulk + editor + shortcuts)

Full rewrite of `apps/client/src/pages/Posts.tsx`. New state:
- `checkedIds: Set<string>` — bulk selection
- `editMode: boolean` — preview pane edit toggle
- `draft: { title, excerpt, content }` — edit draft
- `shortcutHelp: boolean` — shortcut reference dialog

New mutations: `bulkApprove`, `bulkReject`, `bulkRemove` (all use `Promise.allSettled`), `updatePost` (calls `postsApi.update`).

New keyboard handler in `useEffect` — skips when focus is on INPUT/TEXTAREA/SELECT:
- j/k: navigate selected post
- a/r: approve/reject
- e: toggle edit mode
- Escape: cancel edit or clear selection

New components: `ShortcutHelp` (Dialog listing shortcuts).

Commit: `feat: bulk post actions, inline editor, keyboard shortcuts`

---

## Task 4 — SSE endpoint

Modify `apps/server/src/routes/sources.ts`. Add imports:
```typescript
import { fetchQueue, fetchQueueEvents } from '../queue.js'
```

Add `GET /sources/events` route: authenticated, writes SSE stream to `reply.raw`, listens to `fetchQueueEvents` active/completed/failed events, looks up `sourceId` from job data via `fetchQueue.getJob(jobId)`, resolves when client disconnects via `req.raw.once('close', resolve)`.

Commit: `feat: GET /sources/events SSE stream`

---

## Task 5 — Sources.tsx SSE integration

Modify `apps/client/src/pages/Sources.tsx`.

Add `activeJobs: Record<string, 'active'|'completed'|'failed'>` state.

Add `useEffect` that connects via `fetch('/api/sources/events', { headers: { Authorization } })` + `ReadableStream` reader. Parses SSE `data:` lines, updates `activeJobs`, invalidates sources query on complete/failed, clears status after 3s. Auto-reconnects after 3s on non-abort error.

In each source card, make Fetch button show `Loader2` when `activeJobs[src.id] === 'active'` and the correct icon on completed/failed.

Commit: `feat: per-source SSE fetch progress on Sources page`

---

## Task 6 — Queue stats endpoint

Modify `apps/server/src/routes/dashboard.ts`. Add imports + route:

```typescript
import { fetchQueue, publishQueue } from '../queue.js'

// inside dashboardRoutes:
app.get('/dashboard/queues', { preHandler: [app.authenticate] }, async () => {
  const [f, p] = await Promise.all([
    fetchQueue.getJobCounts('waiting', 'active', 'failed'),
    publishQueue.getJobCounts('waiting', 'active', 'failed'),
  ])
  return { fetch: f, publish: p }
})
```

Commit: `feat: GET /dashboard/queues job counts`

---

## Task 7 — Sidebar queue panel

Modify `apps/client/src/components/layout/Sidebar.tsx`.

Add `useQuery({ queryKey: ['queue-stats'], queryFn: dashboardApi.queues, refetchInterval: 10_000, retry: false })`.

Add `queueOpen` state + a collapsible "Queues" button in the nav (below the main links). Show a dot indicator (grey/yellow/red) reflecting idle/active/failed state. Expanded panel shows fetch and publish queue counts (waiting/active/failed) with red/yellow coloring on non-zero failed/active.

Commit: `feat: queue status panel in sidebar`
