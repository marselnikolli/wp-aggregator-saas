# WP Aggregator SaaS — Backlog

## Completed

### [x] Social sharing redesign

- [x] Add "Published" tab on Posts page filtering by publishStatus
- [x] Fix ShareDialog to show destination URL, restrict to published posts
- [x] Fix `resolvePostUrl` in socialWorker.ts — no fallback to originalUrl, fail instead
- [x] Fix caption generation to use wpUrl instead of undefined
- [x] Add validation in POST /social/publish — require DONE publish task
- [x] Add DB index on PublishTask

### [x] Source posted date is 2h earlier than actual time

- [x] Added `TZ: Europe/Tirane` to postgres, server, and worker containers in docker-compose

### [x] Date filter needs proper granular time options

- [x] Added "Last hour", "Last 2 hours", "Last 6 hours" presets alongside existing options

### [x] Posts created on the fly don't get featured image or category

- [x] Enhanced `tryOgImageFallback` to also look for first `<img>` in article body when og:image is missing
- [x] AI summarizer already appends AI-suggested categories to post categories

### [x] Auto-clear scraped/unpublished posts after 1 week

- [x] Created `apps/server/src/workers/cleaner.ts` — runs every 24h, deletes DRAFT posts older than 7 days
- [x] Registered in `worker-runner.ts`

### [x] Mystery "asl" text in preview pane

- [x] Searched entire codebase (client + server) — no "asl" text found anywhere. Likely content from a specific feed article or already resolved.

### [x] Sources grouping filter

- [x] Added `GET /sources/groups` backend endpoint returning distinct group names
- [x] Added `sourcesApi.groups()` client API method
- [x] Added group filter dropdown on Sources page

### [x] Restrict language filter to: Albanian, English, Italian, Spanish only

- [x] Filtered language options in Posts page to only show `sq`, `en`, `it`, `es`
