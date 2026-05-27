# Social Media Image Template Designer — Spec

## Concept

A visual drag-and-drop canvas where users design 1080×1080 image templates for Facebook and Instagram posts. Each template defines **where** graphical elements appear on the image. When a post is shared, the server renders the final image using Sharp, compositing the post's featured image, gradient, title, category badge, and logo according to the saved template layout.

The caption and hashtags are generated separately (existing caption template system) and attached as post text. The image template controls only the visual layer.

---

## Architecture

```
Template Designer (browser)
  └─ drag elements on 1080×1080 canvas preview
  └─ save layout as JSON { elements: [...] } to DB

Post Share / Pipeline auto-share
  └─ socialWorker picks up job
  └─ loads ImageTemplate from DB
  └─ generateSocialImage(post, template) in social-image.ts
       └─ sharp: background = post.imageUrl (cover fill)
       └─ sharp composite: gradient overlay (color from category map)
       └─ sharp composite: title SVG
       └─ sharp composite: category badge SVG
       └─ sharp composite: logo (fetched from logoUrl)
  └─ upload to S3/R2 → post to Facebook/Instagram
```

---

## Canvas elements

Each element has a position and size stored as **percentages of 1080** so the designer preview (CSS) and Sharp renderer (pixels) stay in sync.

| Element | Description | Configurable |
|---|---|---|
| `background` | Post's featured image, always full-bleed cover | Not draggable (always fills canvas) |
| `gradient` | Color overlay across the full image | Opacity (0–1), direction (top/bottom/left/right), color source |
| `title` | Post title text | x, y, width, font size, color, max lines (1–5) |
| `category` | Category name in a colored pill badge | x, y, font size, badge style (pill/square) |
| `logo` | Brand logo image uploaded per template | x, y, width (aspect-ratio preserved) |
| `domain` | Website domain text (e.g. "lajme.al") | x, y, font size, color |

### Gradient color source
- `category` — reads `categoryColors[post.categories[0]]` from settings, falls back to `#1a1a2e`
- `fixed` — a single hex color chosen at design time, same for every post

### Element position schema
```ts
interface TemplateElement {
  id:        string           // uuid, stable across saves
  type:      'gradient' | 'title' | 'category' | 'logo' | 'domain'
  x:         number           // left edge, % of canvas (0–100)
  y:         number           // top edge, % of canvas (0–100)
  width:     number           // element width, % of canvas
  height?:   number           // element height, % of canvas (auto for text)
  // Text elements
  fontSize?:    number        // px at 1080×1080 scale
  color?:       string        // hex
  maxLines?:    number
  // Gradient
  opacity?:     number
  direction?:   'bottom' | 'top' | 'left' | 'right'
  colorSource?: 'category' | 'fixed'
  fixedColor?:  string
  // Badge
  badgeStyle?:  'pill' | 'square'
}
```

---

## Database changes

### New model: `ImageTemplate`

```prisma
model ImageTemplate {
  id        String   @id @default(cuid())
  name      String
  platform  SocialPlatform
  elements  Json     // TemplateElement[]
  logoUrl   String?  // S3/R2 URL of uploaded logo, null if no logo element
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Add optional reference in `Pipeline`:
```prisma
imageTemplateId String?
imageTemplate   ImageTemplate? @relation(...)
```

---

## New backend routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/image-templates` | List all templates |
| `POST` | `/image-templates` | Create template (name, platform, elements JSON) |
| `PATCH` | `/image-templates/:id` | Update layout |
| `DELETE` | `/image-templates/:id` | Remove template |
| `POST` | `/image-templates/:id/logo` | Upload logo — `multipart/form-data`, stores to S3/R2, returns `{ logoUrl }` |
| `POST` | `/image-templates/:id/preview` | Render a preview PNG using a sample postId — returns image buffer |

---

## Frontend: Template Designer page (`/social/templates`)

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│  [Template name]              [Platform: FB / IG]  [Save]   │
├──────────────────┬──────────────────────────────────────────┤
│  Element panel   │         Canvas (1:1 preview)             │
│                  │    ┌─────────────────────────┐           │
│  + Add gradient  │    │                         │           │
│  + Add title     │    │   [logo]      [domain]  │           │
│  + Add category  │    │                         │           │
│  + Add logo      │    │   [gradient overlay]    │           │
│  + Add domain    │    │   [title text...]        │           │
│  ─────────────   │    │   [category badge]       │           │
│  Selected:       │    └─────────────────────────┘           │
│  Title           │                                          │
│  Font size: 52   │  Preview post: [picker dropdown]         │
│  Color: #fff     │  [Render preview] button → shows actual  │
│  Max lines: 4    │  Sharp output                            │
│  x: 8%  y: 75%  │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

### Canvas behavior
- Canvas renders as a div scaled to fit available space (CSS `aspect-ratio: 1`)
- Each element is an absolutely-positioned div inside the canvas
- Drag via `react-rnd` — updates `x`, `y`, `width` in state as % values
- Click element to select → properties panel updates on left
- Element stack order = array order (drag to reorder in panel)
- Background image shown as CSS `background-image: cover` (non-interactive)

### Element panel
- List of active elements with type icon and delete button
- "Add element" buttons for each type (gradient, title, category, logo, domain)
- Each template can only have **one** of: gradient, title, category, domain
- Logo can be added only if a logo file has been uploaded for this template

### Logo upload
- "Upload Logo" button opens file picker (PNG/SVG, max 2MB)
- POSTs to `/image-templates/:id/logo`
- Logo element becomes available in "Add element" list after upload
- Shows thumbnail in panel

### Render preview
- "Render preview" button calls `POST /image-templates/:id/preview` with `{ postId }`
- Returns actual Sharp-rendered JPEG, shown in a modal
- Lets user verify exactly what will post to Facebook/Instagram

---

## Sharp renderer updates (`lib/social-image.ts`)

`generateSocialImage` must accept an `ImageTemplate` (elements array + logoUrl) instead of the current hardcoded layout:

```ts
export async function generateSocialImage(opts: {
  post: { title: string; categories: string[]; imageUrl?: string }
  template: ImageTemplate
  categoryColors: Record<string, string>
}): Promise<Buffer>
```

Processing order (Sharp composites applied bottom-to-top):
1. Base: post.imageUrl → resize 1080×1080 cover (or solid dark bg if no image)
2. For each element in `template.elements` (in array order):
   - `gradient` → SVG rect with linear-gradient, color from categoryColors or fixedColor
   - `title` → SVG `<text>` tspans, word-wrapped to maxLines at width
   - `category` → SVG pill shape + text
   - `logo` → fetch logoUrl → composite at x/y/width px
   - `domain` → SVG text

All x/y/width/height values are stored as `%` → multiply by `1080/100` for Sharp pixel coordinates.

---

## Implementation order

1. **Prisma**: Add `ImageTemplate` model + migration
2. **Routes**: CRUD + logo upload + preview render endpoint
3. **`social-image.ts`**: Refactor to accept template elements array
4. **`socialWorker.ts`**: Pass image template when `template === 'image_overlay'`
5. **Frontend**: Template list sidebar + canvas designer + element panel + logo upload
6. **Frontend**: Render preview modal
7. **Pipeline form**: Add `imageTemplateId` selector alongside `socialTemplate`

---

## Dependencies

- `react-rnd` — drag + resize for canvas elements (client)
- `multer` or Fastify multipart — logo file upload (server, already available via `@fastify/multipart`)
- `sharp` — already installed

---

## Open questions / decisions

- **Font rendering in Sharp SVG**: Sharp uses the system's libvips SVG renderer (librsvg). Custom fonts require the font file to be available in the Docker container — start with system fonts (Arial/sans-serif), add custom font later if needed.
- **Logo format**: Accept PNG and SVG. For SVG logos, Sharp can composite them directly. For PNG, fetch + buffer.
- **Category badge color**: Use the same `categoryColors` map from Settings, same source as gradient. If category has no color mapping, use a neutral dark pill.
- **Mobile preview**: Canvas preview in the designer is desktop-only for now.
