# WP Aggregator SaaS — Backlog

## Legend
> Skill tags indicate which superpowers skill to invoke before starting the task.

---

## [ ] Featured image: download locally & rename by post title-slug
**Skill:** `incremental-implementation`

- At fetch time: slugify `post.title` → `my-post-title.jpg`
- Download image bytes, upload to S3/R2 using the slug as filename (override SHA-256 naming in `lib/image-storage.ts`)
- Update `AggregatedPost.imageUrl` to the public CDN URL
- Files: `workers/fetcher.ts` → `lib/image-storage.ts` (add `filename` param) → `workers/publisher.ts`

---

## [ ] Post editor in view pane: full rich-text editor
**Skill:** `brainstorming` → `react-expert`

- Replace the plain `<textarea>` in the preview/edit pane with TipTap (headless, Tailwind-compatible)
- Toolbar: bold, italic, underline, headings (H2/H3), bullet list, ordered list, link, image
- Output: raw HTML stored in `content` field (same format as current)
- File: `client/src/pages/Posts.tsx` (editor section of the preview pane)

---

## [ ] Dashboard: "Trending" posts section
**Skill:** `feature-forge` → `similarity-search-patterns`

- New `GET /dashboard/trending` endpoint
- Cluster posts by: `semanticDupOf` chains, or title Jaccard similarity (≥ 0.6), or same-day same-source keyword overlap
- Rank clusters by size; return top 10 topics with representative title + count
- Frontend: card on `Dashboard.tsx` below stats grid — topic chips with count badges
- Files: `routes/dashboard.ts` → `client/src/pages/Dashboard.tsx`

---

## [ ] Progress bar during fetch
**Skill:** `react-expert` + `incremental-implementation`

- Backend: call `job.updateProgress(n / total * 100)` inside the per-item loop in `workers/fetcher.ts`
- Expose progress on existing SSE stream (`GET /sources/:id/fetch` SSE endpoint)
- Frontend: animated linear progress bar per source card while fetch is active; disappears on completion
- Files: `workers/fetcher.ts` → `routes/sources.ts` → `client/src/pages/Sources.tsx`

---

## [ ] Limit to last 10–15 posts per source fetch
**Skill:** `incremental-implementation`

- `fetchWpApi`: `url.searchParams.set('per_page', '15')` (currently 20)
- `fetchRss`: set `maxItems: 15` in rss-parser options
- `fetchCustomApi`: break after collecting 15 items across all category IDs
- Consider adding a `maxPostsPerFetch` field to the Source model for per-source override

---

## [ ] Multiple automation pipelines
**Skill:** `feature-forge` → `spec-driven-development`

- New `Pipeline` Prisma model: `{ id, name, enabled, sourceFilter (tag/type/sourceId[]), qualityMin, autoPublish, siteIds[], schedule (cron string), defaultStatus }`
- Replace single global pipeline config (`pipeline_default_*` settings) with a list of named pipelines
- Each pipeline runs independently as a BullMQ repeatable job
- UI: new `/pipelines` page with create/edit/delete/enable toggle
- Files: `prisma/schema.prisma` → `routes/pipelines.ts` → `workers/pipelineRunner.ts` → `client/src/pages/Pipelines.tsx`

---

## [x] HTML content cleanup on import
**Done** — 10-pass cheerio pipeline in `workers/fetcher.ts → cleanContent()`:
scripts/styles/forms, WP boilerplate blocks, ad-pattern class/id, iframe allowlist,
lazy-image promotion, tracking pixel removal, attribute stripping (on*, style, data-*),
empty block removal, br collapse, WP block comments & shortcodes.
