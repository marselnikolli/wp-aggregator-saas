# Custom CMS Support Design

## Goal

Add a `CUSTOM_API` source type for non-standard JSON endpoints (e.g. `https://www.oranews.tv/meshume.php?j=60&id={id}`) with auto-discovery of valid category IDs and configurable field mapping.

## Architecture

Extends the existing `Source` table with three new nullable JSON/string columns. The fetcher worker gains a `fetchCustomApi` function dispatched via the existing `processSource` switch. A new `POST /sources/scan-custom` API endpoint handles the probe-and-discover step in the UI setup flow.

No new database tables. Consistent with existing flat column pattern for `interval`, `username`, `password`.

## Schema Changes

Three new fields on `Source`:

```
fieldMap          Json?   // { title, content, excerpt, imageUrl, originalUrl, remoteId, author } -> dot-paths
categoryMappings  Json?   // [{ id: string, name: string }]
paginationParam   String? // query param name for page number, null = single-page
```

## API Changes

### POST /sources/scan-custom

Request: `{ endpoint: string }` — endpoint template with `{id}` placeholder

Behaviour:
- Probes `id=1..100` in parallel batches of 10
- Stops after 10 consecutive empty/error responses
- For each valid ID: inspects first response item for category name field (checks: `category`, `cat`, `section`, `rubric`, `tema`, `kategori`, `category_name`)
- Auto-detects JSON structure: top-level array or wrapped `{ data: [...] }` / `{ items: [...] }` / `{ posts: [...] }`
- Returns: `{ categories: [{ id, name, count }], suggestedFieldMap: { title, content, ... }, sampleKeys: string[] }`

### PATCH /sources/:id (extended)

Accepts new fields: `fieldMap`, `categoryMappings`, `paginationParam`

## Fetcher Worker

New `fetchCustomApi(source)` function:

1. For each `{ id, name }` in `categoryMappings`:
   - page = 1
   - loop:
     - GET `endpoint` with `{id}` replaced + `paginationParam=page` (if configured)
     - Auto-unwrap response (array or wrapper object)
     - If empty array → break
     - Map each item using `fieldMap` dot-path resolver
     - Tag posts with category `name`
     - If `paginationParam` null → break after first page
     - Else page++
2. Dot-path resolver: `resolve("title.rendered", obj)` → `obj.title?.rendered`

## UI Changes

### AddSourceDialog / EditSourceDialog

When `type = CUSTOM_API`:

1. **Endpoint** input — with `{id}` placeholder hint
2. **"Scan categories"** button → calls `POST /sources/scan-custom`
   - Shows spinner while probing
   - Populates editable category table: ID | Name (editable) | Posts found
   - Shows auto-suggested field mapping below
3. **Field mapping** section — 7 rows (title, content, excerpt, imageUrl, originalUrl, remoteId, author), each a text input pre-filled from `suggestedFieldMap`
4. **Pagination param** input — optional, leave blank for single-page
5. Save stores `fieldMap`, `categoryMappings`, `paginationParam`

## Data Flow

```
User enters endpoint → Scan button → /sources/scan-custom
  → probes id 1..100 in batches
  → returns discovered categories + suggested field map
User edits names/fields → Save → PATCH /sources/:id
  → stored in DB

Fetch job triggered → processSource → fetchCustomApi
  → for each category: fetch pages → map fields → upsert posts
```

## Error Handling

- Scan: individual probe failures are silently skipped; returns whatever was found
- Fetch: if a category returns an error, log to `lastError`, increment `errorCount`, continue with remaining categories
- Bad dot-path: resolve returns `null` (post saved with null field, not skipped)

## Out of Scope

- Cloudflare bypass (User-Agent spoofing, cookie jar) — deferred
- Proxy support — deferred
- Visual field-mapping drag-and-drop — text inputs sufficient
