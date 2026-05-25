# Source Management — Design Spec
Date: 2026-05-24

## Overview

Four enhancements to the Sources layer: per-source fetch intervals, optional Basic Auth credentials, RSS auto-detection, and inline health stats on each source card.

---

## Schema Changes (Source model)

```
interval    String?   // null=disabled | '15m' | '1h' | '6h' | '24h'
username    String?   // WP Basic Auth username
password    String?   // encrypted with lib/crypto.ts encrypt()
lastError   String?   // last fetch error message
fetchCount  Int       @default(0)
errorCount  Int       @default(0)
```

Run `prisma db push` on startup (already wired in entrypoint.sh).

---

## Per-source Fetch Interval

**Backend:** When `PATCH /sources/:id` receives an `interval` change, the route:
1. Saves the new value to the DB
2. If `interval` is non-null: calls `fetchQueue.upsertJobScheduler('fetch-source-<id>', { every: MS }, { name: 'fetch-source', data: { sourceId: id } })`
3. If `interval` is null: calls `fetchQueue.removeJobScheduler('fetch-source-<id>')`

Interval → ms mapping: `15m=900_000`, `1h=3_600_000`, `6h=21_600_000`, `24h=86_400_000`.

On server startup, re-register all schedulers for sources that have a non-null `interval` (handles restarts losing in-memory schedulers).

**UI:** Edit source dialog adds an "Auto-fetch interval" dropdown: Disabled / Every 15 min / Every hour / Every 6 hours / Daily.

---

## Optional Credentials

**Backend:** `PATCH /sources/:id` accepts `username` and `password`. Password is `encrypt()`-ed before storage. A sentinel value `'__UNCHANGED__'` from the client means "don't touch the stored password".

**Fetcher worker:** `processSource` reads `source.username` and `source.password`. If both present, decrypts the password and adds `Authorization: Basic <base64(user:pass)>` to the WP API fetch headers. RSS parser uses a custom `requestOptions` with the same header.

**UI:** Edit dialog shows Username and Password fields. Password field is masked and placeholder says "Leave blank to keep existing" when editing.

---

## RSS Auto-Detection

**Backend:** `POST /sources/detect` accepts `{ url: string }`. Normalises URL (adds `https://` if missing). Probes 6 paths in parallel with 5s timeout:
1. `/wp-json/wp/v2/posts?per_page=1` — success + JSON array → `WP_API`
2. `/feed` — success + XML content-type → `RSS`
3. `/rss` → `RSS`
4. `/feed.xml` → `RSS`
5. `/atom.xml` → `RSS`
6. `/rss.xml` → `RSS`

Returns `{ type: 'WP_API'|'RSS', endpoint: string, name: string }` for the first hit, or `{ error: 'No feed found' }`.

**UI:** Endpoint URL field in AddSourceDialog gets a "Detect" button. Clicking it calls the endpoint and auto-fills type + endpoint. While detecting, the button shows a spinner. On failure, shows a toast.

---

## Source Health Stats

**Fetcher worker:** On success, increment `fetchCount` by 1 and clear `lastError`. On failure, increment `errorCount` by 1 and set `lastError` to the error message (truncated at 200 chars).

**Sources API:** `GET /sources` response already includes all fields — no endpoint change needed.

**Source card UI:**
- Below the endpoint line: if `lastError` is set and `fetchStatus === 'ERROR'`, show a truncated red line with the message
- Next to the fetchStatus badge: show `N ok · N err` in muted text using `fetchCount` / `errorCount`

---

## Edit Source Dialog

Replaces the current read-only card with an editable dialog. Pencil icon added to each source card. Fields:
- Name (text input, pre-filled)
- Endpoint URL (text input) + Detect button
- Type toggle (RSS / WP_API)
- Auto-fetch interval (select: Disabled / 15 min / 1h / 6h / Daily)
- Username (text input, optional)
- Password (password input, placeholder "Leave blank to keep existing")

Save calls `PATCH /sources/:id` with changed fields. Password only sent if the field is non-empty; uses `__UNCHANGED__` sentinel on the wire is unnecessary — simply omit `password` from the patch body if the field is empty.

---

## Error Handling

- Detect with no feed found: toast "No feed detected at this URL"
- Detect network error: toast "Could not reach URL"
- Interval update fails: toast "Failed to update schedule"
- Credential decrypt error in fetcher: log and skip auth (don't crash the fetch)
