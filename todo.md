# WP Aggregator SaaS — Todo

## Source Management
- [ ] Optional credentials for WP REST API sources (public endpoints work without auth)
- [ ] Custom API source type with field mapping (e.g. meshume.php?j=60&id=4&p= style endpoints) - for each website that matches this API source it will be needed to map each ID number with the category name
- [ ] RSS auto-detection (enter domain URL, auto-probe /feed, /rss, /feed.xml, /atom.xml)
- [x] Bulk import sources from text file (one URL per line, domain-only URLs supported)
- [ ] Per-source fetch interval (each source can have its own cron: every 15min, 1h, 6h, daily)
- [ ] Source health dashboard (success rate, avg fetch time, error history)
- [ ] Source categories/tags for organisation
- [ ] Source-level category mapping (map remote categories to local WP categories per target site)
- [ ] Detect and handle paginated sources (fetch multiple pages per run)
- [ ] Source deduplication (warn if same domain added twice under different paths)
- [x] Sources page pagination
- [x] Preview pane featured image

## Custom CMS Support (oranews.tv-style)
- [ ] CUSTOM_API source type with configurable endpoint template and field mapping
- [ ] Field mapper UI: point to JSON paths for title, content, excerpt, image, date, url, id
- [ ] Pagination config: param name, starting value, increment
- [ ] Cloudflare bypass strategy: configurable User-Agent, cookie jar, optional proxy
- [ ] Auto-detect if endpoint returns JSON array vs wrapped object (e.g. {data: [...]} vs [...])
- [ ] Support for multiple category IDs per source (fetch ?id=1, ?id=2, etc.)

## AI Intelligence Layer
- [ ] OpenAI / Claude / Gemini summarization worker (actually call APIs — field exists but unused)
- [ ] AI title rewriting (make titles SEO-friendly, fix all-caps Albanian news titles)
- [ ] Auto language detection (langdetect or franc.js)
- [ ] AI-powered translation (Albanian → other languages or vice versa)
- [ ] Auto keyword/tag extraction (feed into WP tags on publish)
- [ ] AI content categorisation (suggest WP category based on content)
- [ ] Quality scoring engine: readability score + length + image presence + source trust score
- [ ] Semantic duplicate detection (embedding similarity, not just hash)
- [ ] AI-generated excerpt if original is missing or too short

## Automation Pipeline
- [ ] Fully automated pipeline mode: fetch → AI enrich → score → auto-approve if score ≥ N → publish
- [ ] Per-source automation config (some sources trusted/auto-approved, others need review)
- [ ] Auto-reject rules: block posts matching keyword list, below quality threshold
- [ ] Scheduled publishing: publish at specific times (e.g. every morning at 08:00)
- [ ] Round-robin publishing (spread posts across sites evenly)
- [ ] Publish to multiple sites simultaneously with per-site category/tag overrides

## Publishing
- [ ] Featured image download + re-upload to target WP media library before publishing
- [ ] WP category auto-creation on target site if category doesn't exist
- [ ] WP tag sync (create tags from extracted keywords)
- [ ] Post status control (publish immediately vs draft vs scheduled)
- [ ] Per-site publish settings: default category, default author, post format
- [ ] Republish / update already-published post if source updated

## UI / UX
- [x] Inline post preview panel (always-visible static pane with featured image)
- [x] Bulk select + approve / reject / delete posts
- [x] Post content editor (edit title, excerpt, content before publishing)
- [x] Post search + advanced filters (source, category, date range)
- [x] Real-time fetch progress via SSE (per-source on Sources page)
- [x] Queue status panel (BullMQ job counts in sidebar)
- [x] Keyboard shortcuts (j/k navigate, a approve, r reject, e edit, Esc cancel)
- [x] Ad stripping from fetched content (keep social/video embeds)
- [ ] Source drag-and-drop reordering
- [ ] Mobile-responsive layout pass

## Infrastructure & Performance
- [ ] Separate worker process (split from API server, run as own container)
- [ ] BullBoard job queue dashboard (visual inspection of queues)
- [ ] Per-source rate limiting (respect robots.txt + min delay between requests)
- [ ] Redis-based distributed lock (prevent duplicate fetches if worker restarts mid-job)
- [ ] S3/R2 image storage (store downloaded images in object storage, not just URL reference)
- [ ] Caching layer (cache fetched feeds for N minutes, avoid hammering sources)
- [ ] DB query optimisation (add composite indexes for common filter combos)
- [ ] Prometheus metrics endpoint + Grafana dashboard
- [ ] Sentry error tracking integration

## Security & Auth
- [ ] Role-based access control (admin / editor / viewer)
- [ ] API key management (generate API keys for external integrations)
- [ ] Audit log (who approved/rejected/published what, and when)
- [ ] 2FA (TOTP)
- [ ] Session management (view + revoke active sessions)
- [ ] IP allowlist for API access

## Settings & Config
- [ ] Working AI provider settings (save/load keys, test connection)
- [ ] Global auto-fetch toggle + default interval
- [ ] Default publishing pipeline config
- [ ] Notification preferences (email on fetch error, daily digest)
- [ ] Webhook outbound (POST to external URL on new post / publish event)
- [ ] Export all data (sources, posts, settings) to JSON
- [ ] Import/restore from export
