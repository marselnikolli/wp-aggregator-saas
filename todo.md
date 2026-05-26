# WP Aggregator SaaS — Backlog

---

## [x] Remove approve/reject workflow

Posts are available to publish immediately after fetch. No approval gate.

**Schema** (`prisma/schema.prisma`):
- Drop `approvalStatus ApprovalStatus` field from `AggregatedPost`
- Drop `ApprovalStatus` enum (`PENDING | APPROVED | REJECTED`)
- Drop `autoApprove Boolean` from `Source`
- Drop composite indexes `[approvalStatus, createdAt]` and `[sourceId, approvalStatus]`
- Run `prisma db push`

**Backend** — remove all references to `approvalStatus`:
- `routes/posts.ts` — remove filter params `status=PENDING/APPROVED`, default to no filter
- `routes/sources.ts` — remove `autoApprove` from source create/update schema
- `workers/fetcher.ts` — remove approval branching; keep blocklist-based skip (`continue` without creating the post if blocked)
- `routes/pipelines.ts` — remove `approvalStatus: 'APPROVED'` from the post filter in `/run`; target all posts with `publishStatus: 'DRAFT'`

**Frontend**:
- `Posts.tsx` — remove Approve / Reject buttons and the status tab bar; keep Delete only
- `Sources.tsx` — remove "Auto-approve" toggle from source edit dialog
- `lib/api.ts` — remove `approvalStatus` query param from posts fetcher

---

## [x] Post preview pane: full content + featured image

The featured image is currently capped at `max-h-52` and the preview lacks a clear title/byline.

**`client/src/pages/Posts.tsx`**:
- Remove `max-h-52` from the featured image (line ~591); display at natural aspect ratio, full pane width, `rounded-lg mb-4`
- Add a prominent `<h1>` title above the image in read-only preview mode (separate from the edit form title)
- Add byline row: source name, author (if present), formatted `createdAt` date
- If `content` is empty, render `excerpt` in a styled blockquote + a muted "Full content not available" note — never silently show nothing
- Note: HTML content is already sanitized server-side by the 10-pass cheerio pipeline before storage; no additional client-side sanitization needed
- Add `pb-10` to the scroll area so content is not cut off at the bottom

---

## [x] Pipelines: category/source routing + translation

Extend the Pipeline model and UI to support the two primary routing patterns:
1. **Category routing** — posts from source category X get published to site Y under WP category Z
2. **Source + translation routing** — posts from source(s) A get translated to language L, then published to site B

**Schema** (`prisma/schema.prisma`) — add fields to `Pipeline`:
- `categoryFilter  String[] @default([])` — source category names to match (empty = all categories pass)
- `translateTo     String?` — ISO 639-1 target language code, e.g. `"sq"`, `"en"`; null = no translation
- `targetCategory  String?` — WP category ID or slug on the destination site (written to `PublishTask.categoryOverride` at run time)

**Backend** (`routes/pipelines.ts`):
- Add `categoryFilter`, `translateTo`, `targetCategory` to the Zod schema and all CRUD handlers
- In the `/run` handler: if `categoryFilter` has entries, add `categories: { hasSome: categoryFilter }` to the Prisma post query
- Pass `translateTo` and `targetCategory` to each enqueued publish task payload

**Worker** (`workers/publisher.ts`):
- Before posting to WP: if `translateTo` is set, call the existing translation service; replace `title` and `content` with translated versions
- Include `categories: [targetCategory ?? site.defaultCategory]` in the WP REST payload

**Frontend** (`client/src/pages/Pipelines.tsx`) — expand the pipeline form:
- **Source filter**: show source names with checkboxes (currently shows raw IDs); add a secondary "filter by tag" toggle
- **Category filter**: chip input — type a category name and press Enter to add; shows which source categories this pipeline watches
- **Translation**: select — "No translation" default, plus language options (`Albanian (sq)`, `English (en)`, `German (de)`, `French (fr)`, `Italian (it)`, `Spanish (es)`)
- **Target WP category**: text input for WP category slug or ID on the destination site; fetched from `GET /sites/:id/categories` once the site is selected
- **Pipeline card**: render active filters as chips — source count, category list, translation arrow (`→ sq`), target site badge

---

## [x] Global fetch progress indicator

The fetch progress bar only shows on the Sources page. Make it visible on every page.

**`client/src/components/layout/FetchProgressBar.tsx`** — new component:
- Opens a single SSE connection to `/api/sources/events`
- Tracks active fetches: `Record<sourceId, { pct: number; sourceName: string }>`
- Clears a source entry 2 s after `job:completed` or `job:failed`
- Renders a fixed thin bar at the **top of the viewport** (position fixed, z-50, full width, 3 px height, primary color fill):
  - 1 source active: fill animates to its `pct`; tooltip on hover shows "Fetching [name]…"
  - Multiple active: show average pct; tooltip lists each source
  - Hidden (fade out) when no fetches are active
- The per-source progress bars on the Sources page can stay as-is or consume the same shared state via a context

**`client/src/App.tsx`** or the root layout:
- Render `<FetchProgressBar />` once, outside the router, so it persists across page navigation

---

## [x] Audit log: auto-clear every 4 hours

AuditLog rows accumulate indefinitely. Delete records older than 4 hours on a schedule.

**`apps/server/src/index.ts`** (or `workers/cleanup.ts`):
- After workers start, schedule a `setInterval` every 4 h that runs:
  `db.auditLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 4 * 60 * 60 * 1000) } } })`
- Run once immediately on startup to clear any stale rows from the last downtime
- Log `[cleanup] deleted N audit log entries` after each run

---

## [x] Publish with destination category

When publishing a post, let the user pick the target WP category. Schema already has `PublishTask.categoryOverride String?` and `Site.defaultCategory String?`.

**Backend** (`routes/sites.ts`):
- `GET /sites/:id/categories` — proxy to `GET /wp-json/wp/v2/categories?per_page=100` on the target site; return `[{ id, name, slug }]`; cache in Redis 10 min under key `wp-cats:<siteId>`

**Worker** (`workers/publisher.ts`):
- Pass `categories: [categoryOverride ?? site.defaultCategory]` in the WP REST post body (currently omitted)

**Frontend** (`Posts.tsx` — PublishDialog):
- Add a category dropdown populated from `/sites/:id/categories`; pre-select `site.defaultCategory`; write selected value to `categoryOverride` in the publish request
- In Sites settings, replace the free-text `defaultCategory` field with a searchable select using the same endpoint

---

## [x] Bulk publish actions

Select multiple posts and publish them in one action.

- `Posts.tsx`: add checkbox column; "Select all" header checkbox; sticky bottom bar showing selected count + "Publish to…" button
- Publish modal: pick site + optional category, fire `POST /posts/bulk-publish` with `{ postIds[], siteId, categoryOverride? }`
- Backend: new route that loops and enqueues a `PublishTask` per post (skip already-queued ones via the existing unique constraint)

---

## [x] Publish log

Show what was published, where, when, and a link to the live WP post.

**Schema**: add `wpUrl String?` to `PublishTask`

**Backend** (`workers/publisher.ts`): after a successful WP REST call, save the response `link` field as `wpUrl` on the `PublishTask` record.

**Frontend**: new "Published" tab or sidebar section — table of DONE publish tasks with: title, site name, published date, WP link (opens new tab), retry button for FAILED tasks.

---

## [ ] Source health view

Surface per-source quality metrics to help identify and prune bad sources.

**Backend** (`routes/sources.ts`):
- Aggregate per source: avg quality score, error rate (`errorCount / fetchCount`), duplicate rate (`semanticDupOf not null / total`), posts in last 7 days

**Frontend** (`Sources.tsx`):
- Expandable stats row under each source card: quality avg bar, error %, duplicate %, 7-day post count
- Sort sources list by health score option in the toolbar

---

## [ ] Featured image fallback via Unsplash

When a post has no `imageUrl` after fetch, search Unsplash for a relevant image.

- `workers/fetcher.ts`: after post insert, if `imageUrl` is null, call Unsplash `/search/photos?query=<title-slug>&per_page=1` using a configured API key; download + upload to S3/R2 via existing `uploadImageFromUrl`
- Add `unsplash_api_key` to the Settings page
- Fallback chain: fetched image → Unsplash search → no image (never blocks publish)

---

## [ ] Scheduled publish spread

Spread pipeline posts evenly across a time window instead of all at once.

**Schema**: add `publishWindowHours Int @default(0)` to `Pipeline`

**Backend** (`routes/pipelines.ts` run handler):
- If `publishWindowHours > 0`, compute BullMQ `delay` for each task: `(index / total) * windowMs`
- Use `publishQueue.add(..., { delay })` so the publisher worker respects the spread

---

## [ ] RSS output of published posts

Expose published posts as a subscribable feed.

- `GET /feed/:token.rss` — RSS 2.0 XML of last 50 posts with `publishStatus = PUBLISHED`, ordered by `publishedDate desc`; feed token stored in Settings (no session auth needed on this route)
- Items include: title, originalUrl as link, excerpt as description, pubDate, imageUrl as enclosure

---

## [x] HTML content cleanup on import
10-pass cheerio pipeline in `workers/fetcher.ts → cleanContent()`.

## [x] Featured image download → S3/R2
`uploadImageFromUrl(slug)` in fetcher at insert time; backfills posts missing images.

## [x] Rich-text editor (TipTap v3)
Bold/italic/strike/code, H2/H3, lists, link, image, undo/redo in Posts edit pane.

## [x] Dashboard trending topics
Jaccard-similarity cluster endpoint + topic chip cards on Dashboard.

## [x] Fetch progress bar (Sources page)
`job.updateProgress` per item → SSE `job:progress` → animated bar per source card in Sources UI.

## [x] Cap to 15 posts per source fetch
`MAX_PER_FETCH = 15` constant across WP_API, RSS, and CUSTOM_API fetchers.

## [x] Multiple automation pipelines
Prisma `Pipeline` model, CRUD REST routes, Pipelines UI page with cron + site targeting.
