# WP Aggregator SaaS — Backlog

## [x] Fix HTML entities in post titles
## [x] Fix missing featured images for RSS sources (og:image scrape fallback)
## [x] Preview pane: show original article permalink (domain + ↗)
## [x] Preview pane: editable categories (inline tag input, auto-save)
## [x] Settings page: reorganize into sections with anchor nav
## [x] Light / dark mode toggle (sidebar footer, persisted to localStorage)

---

## Next suggestions

### [ ] Post deduplication dashboard

Show which posts were marked as semantic duplicates with a "Mark as unique" override to re-queue them for publishing.

### [ ] Multi-language pipeline routing

Route posts to different target sites based on detected language (e.g. `sq` → albanian-site.com, `en` → english-site.com).

### [ ] Broken source alerting

When a source fetch fails N consecutive times, fire a webhook notification with the source name and error message.

### [ ] Content diff viewer

In the post preview, show a side-by-side diff between original content and the AI-rewritten version so editors can compare before publishing.

### [ ] Bulk re-fetch missing images

One-click button on the Sources page to re-scrape og:image for all existing posts that still have no featured image.
