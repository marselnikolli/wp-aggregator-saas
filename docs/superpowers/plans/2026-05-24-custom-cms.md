# Custom CMS Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CUSTOM_API` source type that auto-discovers category IDs from non-standard JSON endpoints (e.g. `https://oranews.tv/meshume.php?j=60&id={id}`) and maps response fields to our standard post schema.

**Architecture:** Three new nullable columns on `Source` (fieldMap, categoryMappings, paginationParam), a shared `lib/customApi.ts` utility module, a new `POST /sources/scan-custom` probe endpoint, a `fetchCustomApi` worker function, and extended Add/Edit source dialogs with scan + field-mapping UI.

**Tech Stack:** Prisma + PostgreSQL (schema), Zod + Fastify (routes), undici `fetch` (probing), React + TanStack Query + shadcn/ui (frontend), TypeScript throughout.

---

### Task 1: Prisma schema — add CUSTOM_API type and three new Source fields

**Files:**
- Modify: `apps/server/prisma/schema.prisma`

- [ ] **Step 1: Edit the SourceType enum and Source model**

In `apps/server/prisma/schema.prisma`, change the `SourceType` enum and add fields to `Source`:

```prisma
enum SourceType {
  RSS
  WP_API
  CUSTOM_API
}
```

Add after `errorCount Int @default(0)` in the `Source` model:

```prisma
  fieldMap          Json?
  categoryMappings  Json?
  paginationParam   String?
```

- [ ] **Step 2: Rebuild the server container to apply the schema**

```bash
docker compose up -d --build server
sleep 8
docker logs wp-aggregator-saas-server-1 2>&1 | tail -8
```

Expected: `The database is already in sync with the Prisma schema.` OR `Your database has been updated`. Server starts without errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/prisma/schema.prisma
git commit -m "feat: add CUSTOM_API source type and fieldMap/categoryMappings/paginationParam fields"
```

---

### Task 2: Shared utility module — unwrapResponse and resolveDotPath

**Files:**
- Create: `apps/server/src/lib/customApi.ts`

- [ ] **Step 1: Create the utility file**

```typescript
// apps/server/src/lib/customApi.ts

const WRAPPER_KEYS = ['data', 'items', 'posts', 'results', 'articles', 'feed', 'list']

export function unwrapResponse(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    for (const key of WRAPPER_KEYS) {
      const val = (data as Record<string, unknown>)[key]
      if (Array.isArray(val)) return val
    }
  }
  return []
}

export function resolveDotPath(path: string, obj: unknown): unknown {
  if (!path || !obj) return null
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur && typeof cur === 'object') return (cur as Record<string, unknown>)[key]
    return null
  }, obj) ?? null
}

export const CAT_NAME_KEYS = [
  'category', 'cat', 'section', 'rubric', 'tema', 'kategori', 'category_name', 'cat_name',
]

export const FIELD_GUESS_MAP: Record<string, string[]> = {
  title:       ['title', 'headline', 'name', 'titulli', 'subject'],
  content:     ['content', 'body', 'text', 'description', 'permbajtja', 'article_body'],
  excerpt:     ['excerpt', 'summary', 'short_description', 'abstract', 'lead'],
  imageUrl:    ['image', 'image_url', 'photo', 'thumbnail', 'img', 'cover', 'featured_image'],
  originalUrl: ['url', 'link', 'permalink', 'href', 'article_url'],
  remoteId:    ['id', 'post_id', 'article_id', 'nid', 'entry_id'],
  author:      ['author', 'writer', 'journalist', 'autori', 'byline'],
}
```

- [ ] **Step 2: Verify it compiles**

```bash
docker exec wp-aggregator-saas-server-1 sh -c "cd /app && node_modules/.bin/tsc --noEmit 2>&1 | head -20"
```

Expected: no output (zero errors).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/lib/customApi.ts
git commit -m "feat: shared customApi utilities (unwrapResponse, resolveDotPath, field guessing)"
```

---

### Task 3: Extend Zod schemas in sources route

**Files:**
- Modify: `apps/server/src/routes/sources.ts`

- [ ] **Step 1: Update sourceBody and sourceUpdateBody**

Replace the two schema constants (lines 32–47) with:

```typescript
const sourceBody = z.object({
  name:     z.string().min(1),
  endpoint: z.string().min(1),
  type:     z.enum(['RSS', 'WP_API', 'CUSTOM_API']).default('RSS'),
  enabled:  z.boolean().optional().default(true),
})

const sourceUpdateBody = z.object({
  name:              z.string().min(1).optional(),
  endpoint:          z.string().min(1).optional(),
  type:              z.enum(['RSS', 'WP_API', 'CUSTOM_API']).optional(),
  enabled:           z.boolean().optional(),
  interval:          z.enum(['15m', '1h', '6h', '24h']).nullable().optional(),
  username:          z.string().optional(),
  password:          z.string().optional(),
  fieldMap:          z.record(z.string()).nullable().optional(),
  categoryMappings:  z.array(z.object({ id: z.string(), name: z.string() })).nullable().optional(),
  paginationParam:   z.string().nullable().optional(),
})
```

Note: `endpoint` changed from `z.string().url()` to `z.string().min(1)` because CUSTOM_API endpoints contain `{id}` which is not a valid URL.

- [ ] **Step 2: Verify it compiles**

```bash
docker exec wp-aggregator-saas-server-1 sh -c "cd /app && node_modules/.bin/tsc --noEmit 2>&1 | head -20"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/sources.ts
git commit -m "feat: extend source Zod schemas for CUSTOM_API (fieldMap, categoryMappings, paginationParam)"
```

---

### Task 4: POST /sources/scan-custom endpoint

**Files:**
- Modify: `apps/server/src/routes/sources.ts`

- [ ] **Step 1: Add the import at the top of sources.ts**

After the existing imports, add:

```typescript
import { unwrapResponse, CAT_NAME_KEYS, FIELD_GUESS_MAP } from '../lib/customApi.js'
```

- [ ] **Step 2: Add the scan-custom route**

Add this route inside `sourcesRoutes`, before the closing brace, after the existing `/sources/import` route:

```typescript
app.post('/sources/scan-custom', { preHandler: [app.authenticate] }, async (req) => {
  const { endpoint } = z.object({ endpoint: z.string().min(1) }).parse(req.body)

  const categories: Array<{ id: string; name: string; count: number }> = []
  let consecutiveMisses = 0

  for (let batchStart = 1; batchStart <= 100 && consecutiveMisses < 10; batchStart += 10) {
    const batchSize = Math.min(10, 101 - batchStart)
    const batchIds = Array.from({ length: batchSize }, (_, i) => batchStart + i)

    const results = await Promise.allSettled(
      batchIds.map(async (id) => {
        const url = endpoint.replace('{id}', String(id))
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error('not ok')
        const data = await res.json()
        const items = unwrapResponse(data)
        if (!items.length) throw new Error('empty')
        const first = items[0] as Record<string, unknown>
        let name: string | undefined
        for (const key of CAT_NAME_KEYS) {
          if (typeof first[key] === 'string' && first[key]) { name = first[key] as string; break }
        }
        return { id: String(id), name: name ?? `Category ${id}`, count: items.length }
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') {
        categories.push(r.value)
        consecutiveMisses = 0
      } else {
        consecutiveMisses++
      }
    }
  }

  let suggestedFieldMap: Record<string, string> = {}
  let sampleKeys: string[] = []

  if (categories.length) {
    try {
      const firstUrl = endpoint.replace('{id}', categories[0].id)
      const res = await fetch(firstUrl, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = await res.json()
        const items = unwrapResponse(data)
        if (items.length) {
          sampleKeys = Object.keys(items[0] as object)
          for (const [field, candidates] of Object.entries(FIELD_GUESS_MAP)) {
            for (const c of candidates) {
              if (sampleKeys.includes(c)) { suggestedFieldMap[field] = c; break }
            }
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  return { categories, suggestedFieldMap, sampleKeys }
})
```

- [ ] **Step 3: Rebuild server and verify**

```bash
docker compose up -d --build server
sleep 8
docker logs wp-aggregator-saas-server-1 2>&1 | tail -5
```

Expected: server starts, no TypeScript/runtime errors.

- [ ] **Step 4: Quick smoke test**

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}' | jq -r .token)

curl -s -X POST http://localhost:3001/api/sources/scan-custom \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"https://www.oranews.tv/meshume.php?j=60&id={id}"}' | jq '{count: (.categories | length), first: .categories[0], fields: .suggestedFieldMap}'
```

Expected: JSON with discovered categories (count > 0), first category object, and suggestedFieldMap keys.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/sources.ts
git commit -m "feat: POST /sources/scan-custom — probe category IDs and auto-suggest field map"
```

---

### Task 5: fetchCustomApi in the fetcher worker

**Files:**
- Modify: `apps/server/src/workers/fetcher.ts`

- [ ] **Step 1: Add imports to fetcher.ts**

After the existing imports, add:

```typescript
import { unwrapResponse, resolveDotPath } from '../lib/customApi.js'
```

- [ ] **Step 2: Add the fetchCustomApi function**

Add this after the `fetchWpApi` function (before `processSource`):

```typescript
async function fetchCustomApi(source: {
  endpoint: string
  fieldMap: unknown
  categoryMappings: unknown
  paginationParam: string | null
}) {
  const fieldMap = (source.fieldMap as Record<string, string> | null) ?? {}
  const categoryMappings = (source.categoryMappings as Array<{ id: string; name: string }> | null) ?? []

  const results: ReturnType<typeof mapRssItem>[] = []

  for (const { id, name } of categoryMappings) {
    let page = 1
    while (true) {
      let url = source.endpoint.replace('{id}', id)
      if (source.paginationParam) url += `&${source.paginationParam}=${page}`

      let items: unknown[]
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
        if (!res.ok) break
        const data = await res.json()
        items = unwrapResponse(data)
      } catch { break }

      if (!items.length) break

      for (const item of items) {
        const get = (field: string, fallback: string) =>
          resolveDotPath(fieldMap[field] ?? fallback, item)

        results.push({
          remoteId:    String(get('remoteId', 'id') ?? Math.random()),
          title:       String(get('title', 'title') ?? ''),
          content:     cleanContent(String(get('content', 'content') ?? '')),
          excerpt:     String(get('excerpt', 'excerpt') ?? '').slice(0, 300),
          imageUrl:    (get('imageUrl', 'image') as string | null) ?? null,
          originalUrl: (get('originalUrl', 'url') as string | null) ?? null,
          author:      (get('author', 'author') as string | null) ?? null,
          categories:  [name],
        })
      }

      if (!source.paginationParam) break
      page++
    }
  }

  return results
}
```

- [ ] **Step 3: Add CUSTOM_API dispatch in processSource**

In `processSource`, replace the two-branch dispatch:

```typescript
const items = source.type === SourceType.RSS
  ? await fetchRss(source.endpoint, auth)
  : await fetchWpApi(source.endpoint, auth)
```

with:

```typescript
const items = source.type === SourceType.RSS
  ? await fetchRss(source.endpoint, auth)
  : source.type === SourceType.WP_API
    ? await fetchWpApi(source.endpoint, auth)
    : await fetchCustomApi(source)
```

- [ ] **Step 4: Rebuild server and verify**

```bash
docker compose up -d --build server
sleep 8
docker logs wp-aggregator-saas-server-1 2>&1 | tail -5
```

Expected: clean startup, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/workers/fetcher.ts
git commit -m "feat: fetchCustomApi worker — iterate categories, resolve dot-path fields, paginate"
```

---

### Task 6: Frontend API helper

**Files:**
- Modify: `apps/client/src/lib/api.ts`

- [ ] **Step 1: Add scanCustom to sourcesApi**

In `apps/client/src/lib/api.ts`, add to `sourcesApi`:

```typescript
  scanCustom: (endpoint: string) => api.post('/sources/scan-custom', { endpoint }).then(r => r.data),
```

The full `sourcesApi` block should look like:

```typescript
export const sourcesApi = {
  list:       (p?: any) => api.get('/sources', { params: p }).then(r => r.data),
  create:     (d: any)  => api.post('/sources', d).then(r => r.data),
  update:     (id: string, d: any) => api.patch(`/sources/${id}`, d).then(r => r.data),
  remove:     (id: string) => api.delete(`/sources/${id}`),
  fetch:      (id: string) => api.post(`/sources/${id}/fetch`).then(r => r.data),
  fetchAll:   () => api.post('/sources/fetch-all').then(r => r.data),
  import:     (urls: string[]) => api.post('/sources/import', { urls }).then(r => r.data),
  categories: (id: string) => api.get(`/sources/${id}/categories`).then(r => r.data),
  detect:     (url: string) => api.post('/sources/detect', { url }).then(r => r.data),
  scanCustom: (endpoint: string) => api.post('/sources/scan-custom', { endpoint }).then(r => r.data),
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/lib/api.ts
git commit -m "feat: add sourcesApi.scanCustom"
```

---

### Task 7: Frontend — CustomApiFields component and dialog integration

**Files:**
- Modify: `apps/client/src/pages/Sources.tsx`

This task adds:
1. Type constants and type definitions at the top of Sources.tsx
2. A `CustomApiFields` component used by both Add and Edit dialogs
3. CUSTOM_API option in both dialogs' type selectors

- [ ] **Step 1: Add constants after existing INTERVALS constant**

After the `const INTERVALS = [...]` constant, add:

```typescript
const CUSTOM_FIELD_LABELS: Record<string, string> = {
  title: 'Title', content: 'Content', excerpt: 'Excerpt',
  imageUrl: 'Image URL', originalUrl: 'Post URL', remoteId: 'ID', author: 'Author',
}

type ScanResult = {
  categories: Array<{ id: string; name: string; count: number }>
  suggestedFieldMap: Record<string, string>
  sampleKeys: string[]
}

type CatMapping = { id: string; name: string }
```

- [ ] **Step 2: Add the CustomApiFields component**

Add this component before `AddSourceDialog`:

```typescript
function CustomApiFields({
  endpoint,
  fieldMap,
  setFieldMap,
  catMappings,
  setCatMappings,
  paginationParam,
  setPaginationParam,
}: {
  endpoint: string
  fieldMap: Record<string, string>
  setFieldMap: (m: Record<string, string>) => void
  catMappings: CatMapping[]
  setCatMappings: (c: CatMapping[]) => void
  paginationParam: string
  setPaginationParam: (p: string) => void
}) {
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')

  async function scan() {
    if (!endpoint.includes('{id}')) {
      setScanError('Endpoint must contain {id} placeholder')
      return
    }
    setScanError('')
    setScanning(true)
    try {
      const result: ScanResult = await sourcesApi.scanCustom(endpoint)
      setCatMappings(result.categories.map(c => ({ id: c.id, name: c.name })))
      setFieldMap(result.suggestedFieldMap)
    } catch {
      setScanError('Scan failed — check endpoint template')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="space-y-4 mt-2">
      <div className="text-xs text-muted-foreground">
        Use <code className="bg-muted px-1 rounded">{'{id}'}</code> as the category ID placeholder in the endpoint.
      </div>

      <Button type="button" variant="outline" size="sm" onClick={scan} disabled={scanning}>
        {scanning ? 'Scanning...' : 'Scan category IDs'}
      </Button>
      {scanError && <p className="text-xs text-destructive">{scanError}</p>}

      {catMappings.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs font-medium">Discovered categories</Label>
          <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2">
            {catMappings.map((cat, i) => (
              <div key={cat.id} className="flex gap-2 items-center">
                <span className="text-xs text-muted-foreground w-8">#{cat.id}</span>
                <Input
                  className="h-6 text-xs"
                  value={cat.name}
                  onChange={e => {
                    const next = [...catMappings]
                    next[i] = { ...cat, name: e.target.value }
                    setCatMappings(next)
                  }}
                />
                <Button
                  type="button" variant="ghost" size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setCatMappings(catMappings.filter((_, j) => j !== i))}
                >×</Button>
              </div>
            ))}
          </div>
          <Button
            type="button" variant="ghost" size="sm"
            onClick={() => setCatMappings([...catMappings, { id: String(catMappings.length + 1), name: '' }])}
          >+ Add category</Button>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs font-medium">Field mapping</Label>
        <div className="space-y-1">
          {Object.keys(CUSTOM_FIELD_LABELS).map(field => (
            <div key={field} className="flex gap-2 items-center">
              <span className="text-xs text-muted-foreground w-24">{CUSTOM_FIELD_LABELS[field]}</span>
              <Input
                className="h-6 text-xs"
                placeholder={field}
                value={fieldMap[field] ?? ''}
                onChange={e => setFieldMap({ ...fieldMap, [field]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Pagination param (leave blank if single-page)</Label>
        <Input
          className="h-8 text-sm"
          placeholder="e.g. p or page"
          value={paginationParam}
          onChange={e => setPaginationParam(e.target.value)}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update AddSourceDialog**

In `AddSourceDialog`, add state for CUSTOM_API fields after existing state declarations:

```typescript
const [fieldMap, setFieldMap] = useState<Record<string, string>>({})
const [catMappings, setCatMappings] = useState<CatMapping[]>([])
const [paginationParam, setPaginationParam] = useState('')
```

Update the type selector to include `CUSTOM_API`:

```typescript
<Select value={type} onValueChange={v => setType(v as any)}>
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectItem value="RSS">RSS</SelectItem>
    <SelectItem value="WP_API">WordPress REST API</SelectItem>
    <SelectItem value="CUSTOM_API">Custom JSON API</SelectItem>
  </SelectContent>
</Select>
```

After the interval selector in `AddSourceDialog`, add:

```typescript
{type === 'CUSTOM_API' && (
  <CustomApiFields
    endpoint={endpoint}
    fieldMap={fieldMap}
    setFieldMap={setFieldMap}
    catMappings={catMappings}
    setCatMappings={setCatMappings}
    paginationParam={paginationParam}
    setPaginationParam={setPaginationParam}
  />
)}
```

In the `createMutation.mutate` call, extend the payload:

```typescript
createMutation.mutate({
  name, endpoint, type, enabled: true,
  ...(type === 'CUSTOM_API' ? {
    fieldMap: Object.fromEntries(Object.entries(fieldMap).filter(([, v]) => v)),
    categoryMappings: catMappings.filter(c => c.id && c.name),
    paginationParam: paginationParam || null,
  } : {}),
})
```

- [ ] **Step 4: Update EditSourceDialog similarly**

In `EditSourceDialog`, initialise the CUSTOM_API state from the source prop:

```typescript
const [fieldMap, setFieldMap] = useState<Record<string, string>>(
  (src.fieldMap as Record<string, string>) ?? {}
)
const [catMappings, setCatMappings] = useState<CatMapping[]>(
  (src.categoryMappings as CatMapping[]) ?? []
)
const [paginationParam, setPaginationParam] = useState<string>(src.paginationParam ?? '')
```

Add the same type selector option and `CustomApiFields` block after the interval selector, and extend the `updateMutation.mutate` payload the same way as in AddSourceDialog.

- [ ] **Step 5: Rebuild client container**

```bash
docker compose up -d --build client
sleep 5
docker logs wp-aggregator-saas-client-1 2>&1 | tail -3
```

Expected: client nginx starts with no errors.

- [ ] **Step 6: Manual UI test**

1. Open http://localhost:8090/sources
2. Click "Add source" → select "Custom JSON API" from type dropdown
3. Enter `https://www.oranews.tv/meshume.php?j=60&id={id}` as endpoint
4. Click "Scan category IDs" — wait for results (10-30 seconds)
5. Verify category table populates with discovered IDs and names
6. Verify field mapping auto-populates with suggested keys
7. Save the source — it appears in the list
8. Click the fetch button on the new source card — posts appear in Posts page

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/pages/Sources.tsx
git commit -m "feat: CUSTOM_API source UI — scan categories, field mapping, pagination config"
```

---

## Self-Review

**Spec coverage:**
- CUSTOM_API source type ✓ (Task 1 schema, Tasks 3/4/5 backend, Task 7 UI)
- Auto-discover category IDs via scan ✓ (Task 4 endpoint)
- Map IDs to category names (auto-detect from response + user editable) ✓ (Task 4 CAT_NAME_KEYS, Task 7 UI)
- Field mapping (title, content, excerpt, imageUrl, originalUrl, remoteId, author) ✓ (Tasks 2+5+7)
- Pagination config ✓ (Tasks 1+5+7)
- Auto-detect array vs wrapper object ✓ (Task 2 unwrapResponse)
- Error handling: per-category failures don't stop other categories ✓ (Task 5 try/catch per category)

**Placeholder scan:** No TBDs or incomplete sections found.

**Type consistency:**
- `CatMapping` defined in Task 7 Step 1, used in Steps 2/3/4 — consistent
- `ScanResult` defined in Task 7 Step 1, used in Step 2 — consistent
- `fetchCustomApi` signature matches `source` fields from Task 1 schema
- `sourcesApi.scanCustom` returns `ScanResult` — consistent with endpoint response in Task 4
