# UI Quick Wins — Design Spec
Date: 2026-05-24

## Overview

Two-phase UI improvement pass on the wp-aggregator-saas client. All changes are confined to `apps/client/src/pages/Posts.tsx`, `apps/client/src/pages/Sources.tsx`, and the server routes layer. No schema changes required.

---

## Phase 1 — Bulk Actions, Inline Editor, Keyboard Shortcuts

### Backend change

Add `PATCH /posts/:id` (general update) accepting `{ title?, excerpt?, content? }`.  
Existing sub-resource routes (`/approve`, `/reject`, `/publish`) are unchanged.

### Bulk Actions

**State:** `selectedIds: Set<string>` held in the Posts component. Separate from the single-post preview selection (`selectedPost`).

**Per-card checkbox:**
- Checkbox rendered inside each post card. Clicking it calls `stopPropagation` so it does not trigger the preview-selection click handler.
- Checkbox is visible on hover, or always visible when `selectedIds.size > 0`.

**List header:**
- "Select all on this page" checkbox. Checked when all visible posts are selected; indeterminate when some are.

**Action bar:**
- Sticky bar at the top of the post list, shown only when `selectedIds.size > 0`.
- Shows: `"N selected"` count, `Clear` link, and three buttons: **Approve**, **Reject**, **Delete**.
- Each button fires the relevant existing single-post API call for every selected ID in parallel (`Promise.all`), then invalidates the `['posts']` query cache and clears `selectedIds`.
- Toast on completion: `"3 posts approved"`.

### Inline Editor

**Trigger:** **Edit** button added to the preview pane header (alongside existing Approve/Reject/Publish buttons).

**Edit mode:** Same right-side preview pane, toggled. The pane shows:
1. Featured image (unchanged, stays at top)
2. `<input>` — title (pre-filled)
3. `<textarea>` — excerpt (~3 rows, pre-filled)
4. `<textarea>` — content (tall, pre-filled with raw HTML)
5. **Save** button + **Cancel** button

**Save:** Calls `PATCH /posts/:id` with only the changed fields. Shows `Loader2` spinner during request. On success: invalidates `['posts']` cache, returns to view mode, shows `"Post updated"` toast.

**Cancel:** Discards local draft state, returns to view mode with no API call.

**Draft state:** Plain `useState` holding `{ title, excerpt, content }`. Initialised from `selectedPost` when Edit is clicked. Nothing is sent until Save.

### Keyboard Shortcuts

A `useEffect` in the Posts page adds a `keydown` listener on `document`. Shortcuts are skipped when `document.activeElement` is `INPUT`, `TEXTAREA`, or has `contenteditable`.

| Key | Action |
|-----|--------|
| `j` | Move preview selection to next post in list |
| `k` | Move preview selection to previous post in list |
| `a` | Approve currently previewed post |
| `r` | Reject currently previewed post |
| `e` | Toggle edit mode on preview pane |
| `Escape` | Cancel edit mode if active; otherwise clear bulk selection |

A `?` icon button in the post list header opens a `Popover` listing these shortcuts.

---

## Phase 2 — SSE Fetch Progress + Queue Status Panel

### SSE Fetch Progress

**Backend:** `GET /sources/events` — Fastify route (authenticated via `preHandler: [app.authenticate]`) that writes an SSE stream to `reply.raw`. Subscribes to BullMQ `fetchQueue` global events (`active`, `completed`, `failed`). Each event emits:
```
data: {"type":"job:active","sourceId":"<id>","jobId":"<id>"}\n\n
data: {"type":"job:completed","sourceId":"<id>"}\n\n
data: {"type":"job:failed","sourceId":"<id>","error":"<msg>"}\n\n
```
The route sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. On client disconnect, unsubscribes from BullMQ events.

**Client:** `useEffect` in `Sources.tsx` opens a single `EventSource('/api/sources/events')`. Maintains `activeJobs: Record<sourceId, 'active' | 'completed' | 'failed'>` in component state. Each source card reads its own entry:
- `active` → replace the Fetch button icon with a spinning `Loader2`
- `completed` → brief green flash on the status badge, then query cache invalidated to refresh `lastFetch`
- `failed` → red error badge overlay

`EventSource` is closed in the `useEffect` cleanup (page unmount).

### Queue Status Panel

**Backend:** `GET /dashboard/queues` — returns BullMQ `getJobCounts()` for both queues:
```json
{
  "fetch":   { "waiting": 0, "active": 1, "failed": 0 },
  "publish": { "waiting": 0, "active": 0, "failed": 2 }
}
```

**Client:** Small **Queue** item at the bottom of the sidebar nav. Dot indicator:
- Grey — all queues idle
- Yellow — any `active > 0`
- Red — any `failed > 0`

Clicking the item expands an inline panel (below the nav link) showing the two queues as rows with `waiting / active / failed` counts. Polled every 10 seconds via TanStack Query `refetchInterval`.

---

## Error Handling

- Bulk action partial failures: if some calls succeed and some fail, show `"2 approved, 1 failed"` toast with the error detail.
- Editor save failure: show error toast, stay in edit mode so the user doesn't lose their draft.
- SSE disconnect: `EventSource` auto-reconnects natively. No manual retry logic needed.
- Queue endpoint failure: silently hide the panel dot — don't show an error for a non-critical status widget.

---

## Out of Scope

- Rich text / WYSIWYG editor (raw HTML textarea is sufficient for now)
- BullBoard UI integration (queue counts link to it in future)
- Mobile-responsive pass (deferred to a separate sub-project)
- Source drag-and-drop reordering (deferred)
