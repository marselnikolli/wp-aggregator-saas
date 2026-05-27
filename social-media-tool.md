# Social Media Integration — Implementation Spec

This document maps the social media plugin's features onto the WP Aggregator SaaS architecture and defines exactly what needs to be built.

---

## Architecture overview

Posts flow through the aggregator as:
```
Source feed → AggregatedPost (DRAFT) → PublishTask → WordPress site
                                     ↓
                              SocialPost → Facebook / Instagram  ← NEW
```

Social sharing is a second publish destination alongside WordPress. It can be:
- **Manual** — user clicks "Share" on a post in the Posts page
- **Automatic** — a Pipeline rule triggers social posting after WordPress publishing

---

## New database models

```prisma
model SocialAccount {
  id          String   @id @default(cuid())
  name        String                           // display name, e.g. "Lajme FB Page"
  platform    SocialPlatform                   // FACEBOOK | INSTAGRAM
  pageId      String                           // Facebook page ID or IG business account ID
  accessToken String                           // encrypted AES-256-CBC (same crypto.ts util)
  siteId      String?                          // optionally scoped to a WP site
  site        Site?    @relation(fields: [siteId], references: [id], onDelete: SetNull)
  enabled     Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  socialPosts SocialPost[]
}

model SocialPost {
  id              String        @id @default(cuid())
  postId          String
  post            AggregatedPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  accountId       String
  account         SocialAccount  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  platform        SocialPlatform
  template        String         // photo_comment | link_post | photo_only | text_link | image_overlay
  status          SocialStatus   @default(PENDING)
  scheduledAt     DateTime?
  publishedAt     DateTime?
  platformPostId  String?        // returned by Facebook/Instagram API after posting
  error           String?
  reach           Int?
  impressions     Int?
  engagement      Int?
  createdAt       DateTime       @default(now())

  @@index([postId])
  @@index([accountId])
  @@index([status])
  @@index([createdAt])
}

model CaptionTemplate {
  id           String   @id @default(cuid())
  name         String
  platform     SocialPlatform
  language     String   @default("sq")         // sq | en
  includeHashtags    Boolean @default(true)
  includeExcerpt     Boolean @default(false)
  brandingText       String?                   // e.g. "📰 Lexo më shumë në..."
  emojiStyle         String  @default("category") // category | none
  categoryColors     Json?                     // { "Politics": "#e74c3c", ... }
  createdAt    DateTime @default(now())
}

enum SocialPlatform {
  FACEBOOK
  INSTAGRAM
}

enum SocialStatus {
  PENDING
  PROCESSING
  DONE
  FAILED
  SCHEDULED
  CANCELLED
}
```

Add to `AggregatedPost`:
```prisma
socialPosts SocialPost[]
```

---

## New backend routes

### `/social-accounts` — CRUD for Facebook/Instagram credentials

| Method | Path | Description |
|---|---|---|
| `GET` | `/social-accounts` | List all accounts |
| `POST` | `/social-accounts` | Create account (token encrypted at rest) |
| `PATCH` | `/social-accounts/:id` | Update name/token/enabled |
| `DELETE` | `/social-accounts/:id` | Remove account |
| `POST` | `/social-accounts/:id/test` | Validate token + permissions via Graph API |

**Token encryption**: use existing `encrypt()`/`decrypt()` from `lib/crypto.ts` — same as WordPress app passwords.

### `/social/publish` — post to Facebook or Instagram

| Method | Path | Description |
|---|---|---|
| `POST` | `/social/publish` | `{ postId, accountId, template, scheduledAt? }` — enqueue to `socialQueue` |
| `POST` | `/social/bulk-publish` | `{ postIds[], accountId, template }` — batch enqueue |
| `GET` | `/social/history` | Paginated `SocialPost` records with filters (platform, status, accountId) |
| `POST` | `/social/history/:id/retry` | Re-enqueue a FAILED SocialPost |
| `DELETE` | `/social/history/:id` | Cancel a SCHEDULED post |

### `/social/analytics`

| Method | Path | Description |
|---|---|---|
| `GET` | `/social/analytics` | Summary stats: total posts, by platform, by template; 30-day daily chart |
| `GET` | `/social/analytics/top` | Top 10 posts by engagement (pulled from `SocialPost.engagement`) |

### `/social/caption-templates` — CRUD for caption templates

### `/social/preview-caption` — `POST { postId, templateId }` → returns generated caption string (no side effects)

---

## New BullMQ worker — `social-worker`

**Queue name**: `social`

**Job data**:
```ts
interface SocialJobData {
  socialPostId: string
}
```

**Flow**:
1. Load `SocialPost` with `post` and `account` (decrypt token)
2. Build caption using `CaptionTemplate` settings
3. Branch by `platform`:
   - **FACEBOOK** → call Graph API `/{pageId}/photos` or `/{pageId}/feed` depending on `template`
   - **INSTAGRAM** → generate quote image with Sharp → upload to `/{igUserId}/media` → publish via `/{igUserId}/media_publish`
4. On success: set `status=DONE`, store `platformPostId`, `publishedAt`
5. On failure: set `status=FAILED`, store `error`

**Image generation for Instagram** (new file `lib/social-image.ts`):
- Use `sharp` (add to server dependencies)
- 1080×1080 canvas
- Gradient overlay from `CaptionTemplate.categoryColors[post.categories[0]]` or a default
- Title text rendered with `@napi-rs/canvas` or `sharp` composite with SVG text

**Caption generation** (new file `lib/caption.ts`):
- Template-based, no AI
- Language: Albanian (`sq`) or English (`en`)
- Category-based emoji prefix lookup table
- Hashtag generation from `post.categories` + `post.aiTags`
- Branding line if configured

---

## Facebook posting templates

| Template key | Graph API call | Notes |
|---|---|---|
| `photo_comment` | `POST /{pageId}/photos` with `url=imageUrl`, then `POST /{photoId}/comments` with link | Two-step |
| `link_post` | `POST /{pageId}/feed` with `link=wpUrl` | Facebook generates OG preview |
| `photo_only` | `POST /{pageId}/photos` with `url=imageUrl, caption=title` | No link |
| `text_link` | `POST /{pageId}/feed` with `message=caption+link` | Plain text post |
| `image_overlay` | Generate overlay image → `POST /{pageId}/photos` + comment with link | Sharp composite |

---

## Pipeline integration

Add optional `socialAccountId` and `socialTemplate` fields to `Pipeline` model so that when a pipeline auto-publishes to WordPress, it also enqueues a social post automatically.

```prisma
// Add to Pipeline model:
socialAccountId String?
socialTemplate  String?
```

In the pipeline run handler (`routes/pipelines.ts`), after enqueuing the WordPress publish task, also enqueue a `socialQueue` job if `pipeline.socialAccountId` is set.

---

## Frontend pages and components

### New sidebar item: **Social** (between History and Settings)
- Icon: `Share2` from lucide-react

### `/social` — Social Accounts page
- List of connected Facebook/Instagram accounts with enable/disable toggle
- "Add Account" dialog: platform selector, page ID field, access token field (masked), optional WP site link
- "Test Connection" button per account (calls `/social-accounts/:id/test`)
- Shows recent post count and last used date

### `/social/post` — Social Queue / History
- Same layout pattern as Publish History (`PublishHistory.tsx`)
- Columns: post title, account name, platform badge, template badge, status badge, published date, engagement
- Retry button for FAILED, Cancel button for SCHEDULED
- Filter by platform, account, status, date range

### Post preview pane — Share button
In `Posts.tsx` right panel, add a "Share" button next to the existing "Publish" button:
- Opens a share dialog: pick account + template, optional schedule datetime
- Shows generated caption preview (calls `/social/preview-caption`)
- Submit → `POST /social/publish`

### `/social/analytics` — Analytics page
- Stat cards: total shares, reach, impressions, engagement (sum of all SocialPosts)
- Platform breakdown pie or bar
- 30-day daily bar chart (same pattern as Dashboard activity chart)
- Top 10 posts table with external links to Facebook/Instagram

### Settings → new **Social Media** section
- Caption templates CRUD (language, hashtags toggle, branding text, emoji style)
- Category color picker (maps `post.categories` values to hex colors for Instagram gradient)

---

## Implementation order

1. **Schema + migration** — add `SocialAccount`, `SocialPost`, `CaptionTemplate` models
2. **Crypto + account routes** — CRUD with token encryption, token test endpoint
3. **Caption generator** (`lib/caption.ts`) — template-based, Albanian/English, hashtags, emoji
4. **Facebook worker** — `social-worker` for Facebook templates (no image generation yet)
5. **Frontend: Social Accounts page** + Share button in Posts preview
6. **Frontend: Social Queue/History page**
7. **Instagram image generation** (`lib/social-image.ts` with Sharp)
8. **Instagram worker** — extend social-worker to handle Instagram flow
9. **Analytics routes + frontend page**
10. **Pipeline integration** — `socialAccountId` + `socialTemplate` fields in Pipeline form
11. **Caption template CRUD UI** in Settings
12. **Category color picker** in Settings

---

## Dependencies to add

```json
// apps/server/package.json
"sharp": "^0.33.0"
```

Sharp is already commonly available in Node Docker images; add to `Dockerfile` with `apk add --no-cache vips-dev` if Alpine-based, or use the pre-built binary.

---

## Token permissions required

**Facebook**:
- `pages_manage_posts`
- `pages_read_engagement`
- `pages_show_list`
- `publish_to_groups` (if posting to groups)

**Instagram** (via Facebook Graph API):
- `instagram_basic`
- `instagram_content_publish`
- `pages_read_engagement`
