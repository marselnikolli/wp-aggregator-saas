# WP Aggregator SaaS — Backlog

## Completed

### [x] Fix HTML entities in post titles
### [x] Fix missing featured images for RSS sources (og:image scrape fallback)
### [x] Preview pane: show original article permalink (domain + ↗)
### [x] Preview pane: editable categories (inline tag input, auto-save)
### [x] Settings page: reorganize into sections with anchor nav
### [x] Light / dark mode toggle (sidebar footer, persisted to localStorage)
### [x] Post deduplication dashboard
### [x] Multi-language pipeline routing
### [x] Broken source alerting
### [x] Content diff viewer
### [x] Bulk re-fetch missing images

---

## Backlog

### [x] Responsive dashboard trending section

The trending/duplicate clusters section on the dashboard should display in a responsive grid, max 6 items per row, collapsing gracefully on smaller screens.

### [x] Social media template preview

Refine the social media caption/image templates. When an editor selects a template in the share dialog, show a live preview of how the post will look on that platform before sharing.

### [x] Content cleanup pipeline

Strip extraneous metadata (author bylines, timestamps, site branding) from the beginning of scraped post content — e.g. articles from Oranews start with "Autor: ... Data: ..." that should be cleaned automatically.

### [x] Show original publish date on posts

Display the original article publication date (from the source website) alongside the aggregated date, so editors can see when the content was originally published.

### [x] Social template deletion

Add a delete button/option for social media caption templates and image templates in the templates management UI.

### [x] Manual source grouping / categories

Allow users to create custom groups/categories on the Sources page to organize sources manually (e.g. "Politics", "Sports", "Technology"), with filtering and bulk actions per group.

### [x] Pipeline workflow visualization

Add a workflow animation/diagram for pipeline execution (similar to n8n) showing the live state of each stage — fetch → summarize → translate → publish — so users can see where in the process a pipeline currently is.

### [x] Real social media analytics

Investigate if there is a direct API integration with Facebook/Instagram to pull real analytics (reach, impressions, engagement) instead of relying on manual entry or placeholder data.
let me know if this is possible if not already avaliable.

### [x] Settings page full-width layout

Redesign the Settings page to use the full page width, with responsive multi-column grouping for related settings sections instead of the current single-column card layout.

### [x] Fetch progress bar

Implement a visible progress bar that tracks the status of source fetching (there's already a `FetchProgressBar` component). Ensure it actually reflects real-time job progress from the BullMQ queue events.

### [ ] User profile editing

Allow team members to edit their own profile data — name, email, and password — from the Team/Account page, instead of requiring admin-only management.
