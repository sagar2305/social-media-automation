# Autonomous TikTok Content Engine — Detailed Implementation Plan

## Context

**Problem:** Manual TikTok content creation is inconsistent and doesn't scale. The user wants a fully autonomous system that researches trends, generates content (images + hooks/captions), posts to TikTok, tracks performance, and self-improves daily — all running via Claude Code's `/loop` command.

**Inspiration:**
- **@leojrr** (222K views) shared a detailed prompt using Virlo API + Postiz for automated TikTok slide accounts with data-driven content decisions
- **@ErnestoSOFTWARE** (917K views, $70k/mo across 11 apps) showed how "Eddie" agent automates faceless content, using the "Larry skill" by @oliverhenry for hooks (8M+ views), Postiz for posting, and daily KPI reporting

**Intended Outcome:** A self-improving content loop that posts TikTok slides daily, measures what works, and autonomously optimizes hooks, formats, and topics over time.

## User Decisions

- **Niche:** AI tools & tech (keywords: "AI tools", "productivity apps", "tech tips", "AI automation", "best AI apps")
- **API keys:** All three ready (Virlo, Postiz, Nano Banana)
- **Post mode:** Draft first — user adds trending sounds manually before publishing
- **Content style:** Start with text + still images (Phase 1), then branded characters (Phase 2)
- **Posting frequency:** 1-2 drafts/day (conservative to avoid TikTok throttling)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Claude Code /loop 8h                    │
│              (runs 3x/day autonomously)                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. RESEARCH ──► Virlo API (trends, hashtags, outliers)  │
│        │                                                 │
│  2. GENERATE ──► Hook/Caption (Henry framework)          │
│        │         + Nano Banana API (slide images)        │
│        │                                                 │
│  3. POST ──────► Postiz API (upload → draft to TikTok)   │
│        │                                                 │
│  4. MEASURE ──► Postiz Analytics API (views/saves/etc)   │
│        │                                                 │
│  5. LEARN ────► autoresearch pattern (A/B log,           │
│                 keep winners, discard losers)             │
│                                                          │
│  Memory: TRENDING-NOW.md | FORMAT-WINNERS.md |           │
│          HASHTAG-BANK.md | LESSONS-LEARNED.md |          │
│          EXPERIMENT-LOG.md | POST-TRACKER.md             │
└────────────────────────────────────────���────────────────┘
```

---

## External Services — Exact API Specifications

### 1. Virlo API (Trend Research)

| Field | Value |
|-------|-------|
| **Base URL** | `https://api.virlo.ai/v1` |
| **Auth Header** | `Authorization: Bearer virlo_tkn_<key>` |
| **Docs** | https://dev.virlo.ai/docs |

**Endpoints we use:**

```
POST /v1/orbit
  Body: {
    name: string,              // "niche check - 2026-03-28"
    keywords: string[],        // 1-10 keywords, multi-word phrases OK
    platforms: ["tiktok"],
    time_period: "this_week",  // "today" | "this_week" | "this_month" | "this_year"
    min_views: 10000,
    run_analysis: true,        // enables AI intelligence report
    exclude_keywords?: string[]
  }
  Response: { orbit_id, status: "queued" }
  Note: Async — poll every 30s, takes 2-10 min. Polling costs 0 credits.

GET /v1/orbit/:orbit_id
  Query: order_by=views&sort=desc
  Response: {
    status: "queued" | "processing" | "completed" | "failed",
    analysis: "markdown report",  // when run_analysis was true
    results: { total_videos, videos: [...], trends: [...] }
  }

GET /v1/orbit/:orbit_id/videos
  Query: limit=20&order_by=views&sort=desc&platforms=tiktok
  Response: {
    total: number,
    videos: [{
      id, url, platform, views, likes, comments,
      publish_date, hashtags, thumbnail_url,
      author: { username, followers, verified }
    }]
  }

GET /v1/orbit/:orbit_id/creators/outliers
  Query: platform=tiktok&order_by=outlier_ratio&sort=desc&limit=20
  Response: [{
    outlier_ratio: number,  // views-to-followers multiplier
    avg_views: number,
    videos_analyzed: number,
    videos: [{ ... performance metrics }]
  }]

GET /v1/hashtags
  Query: start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&limit=30&order_by=views&sort=desc
  Required: start_date and end_date (max 90 days apart)
  Response: { data: [{ hashtag: "#shorts", count: 10926, total_views: 869912593 }] }

GET /v1/hashtags/:hashtag/performance
  Path: hashtag without # (e.g., "aitools")
  Query: start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
  Response: { data: {
    hashtag, video_count, total_views, avg_views,
    total_likes, avg_likes, total_comments, avg_comments
  }}

GET /v1/videos/digest
  Purpose: Top-performing videos from last 48h across platforms
  Response includes: type:"tiktok", views, likes, comments, duration, transcript, hashtags

GET /v1/trends/digest
  Purpose: Today's trending topic groups (generated ~1am UTC daily)
  Response: { data: [{ title, trends: [{ name, description, ranking }] }] }
```

**Error codes:** 400 (bad params), 401 (bad key), 404 (no data), 429 (rate limit)

---

### 2. Postiz API (Posting + Analytics)

| Field | Value |
|-------|-------|
| **Base URL** | `https://api.postiz.com/public/v1` |
| **Auth Header** | `Authorization: <api-key>` (NO "Bearer" prefix!) |
| **Rate Limit** | 30 requests/hour |
| **Docs** | https://docs.postiz.com/public-api |

**Endpoints we use:**

```
POST /upload
  Headers: Authorization + Content-Type: multipart/form-data
  Body: FormData with "file" field (binary)
  Response: {
    id: "uuid",
    name: "filename.mp4",
    path: "https://uploads.postiz.com/...",   // PUBLIC HTTPS URL
    organizationId, createdAt, updatedAt
  }

POST /posts
  Headers: Authorization + Content-Type: application/json
  Body: {
    type: "draft",                              // "schedule" | "now" | "draft"
    date: "2026-03-28T10:00:00.000Z",          // ISO 8601 UTC (for "schedule")
    shortLink: false,
    tags: [],
    posts: [{
      integration: { id: "<TIKTOK_INTEGRATION_ID>" },
      value: [{
        content: "Caption text with #hashtags",
        image: [{
          id: "<upload-id>",                    // from POST /upload response
          path: "https://uploads.postiz.com/..." // from POST /upload response
        }]
      }],
      settings: {
        __type: "tiktok",
        title: "Slide Title",                   // max 90 chars
        privacy_level: "PUBLIC_TO_EVERYONE",     // | "FOLLOWER_OF_CREATOR" | "SELF_ONLY"
        duet: true,
        stitch: true,
        comment: true,
        autoAddMusic: "no",                     // "no" for drafts (user adds sound)
        video_made_with_ai: false,
        content_posting_method: "UPLOAD"         // "UPLOAD" for drafts, "DIRECT_POST" for auto
      }
    }]
  }
  Response: [{ postId: "string", integration: "string" }]

GET /analytics/post/:postId?date=7
  Response: [{
    label: "Likes" | "Comments" | "Shares" | "Views",
    data: [{ total: "string", date: "YYYY-MM-DD" }],
    percentageChange: number
  }]

GET /analytics/:integrationId?date=7
  Response: Same structure as post analytics but account-level
```

**Critical:** TikTok media MUST be publicly accessible HTTPS URLs. Postiz's own upload endpoint handles this — the `path` returned is already a public URL.

---

### 3. Nano Banana API (Image Generation)

| Field | Value |
|-------|-------|
| **Base URL** | `https://www.nananobanana.com/api/v1` |
| **Auth Header** | `Authorization: Bearer nb_<key>` |
| **Docs** | https://nanobananaapi.ai |

**Endpoints we use:**

```
POST /api/v1/generate
  Body: {
    prompt: string,                        // REQUIRED — image description
    selectedModel: "nano-banana-2",        // "nano-banana-fast" (5 cr) | "nano-banana" (10) | "nano-banana-pro" (25) | "nano-banana-2"
    mode: "sync",                          // "sync" | "stream" | "async"
    aspectRatio: "9:16",                   // TikTok vertical — also: "1:1", "16:9", "4:3", "3:2", etc.
    resolution: "1K",                      // "0.5K" | "1K" | "2K" | "4K"
    numImages: 1,                          // 1-4
    outputFormat: "PNG",                   // "PNG" | "JPEG" | "WebP"
    referenceImageUrls: [],                // for character consistency (up to 8, max 10MB each)
    safetyTolerance: 3                     // 1-6 scale
  }

  Sync Response: {
    images: [{
      url: "string",                       // HTTPS URL, valid 15 days
      dimensions: { width, height },
      fileSize: number,
      base64: "string"                     // optional
    }],
    generationId: "string",
    creditsUsed: number,
    generationTime: number                 // milliseconds
  }

  Async Response (initial): { generationId, status: "pending", creditsUsed: 0 }

GET /api/v1/generate?id=<generationId>     // poll async jobs
```

**Pricing:** ~$0.02/base image, 1.5x for 2K, 2x for 4K. Free credits on signup.
**Rate limits:** Free: 5-10 RPM, Pro: 100 RPM
**Character consistency:** Pass reference images in `referenceImageUrls` — preserves up to 5 character identities across generations.
**Text overlay:** Native text rendering in multiple languages via prompt.

---

## Implementation Steps (in build order)

### Step 1: Project Scaffolding & Shared Utilities
**Files:** `config.ts`, `src/api-client.ts`, `.env.local`, memory files, `package.json`

**`src/api-client.ts`** — shared HTTP helper wrapping `fetch` with:
- Auth header injection per service
- Rate limiting (especially Postiz 30/hr)
- Error handling + retry with exponential backoff
- JSON parsing + typed responses

**`config.ts`** — centralized config reading from `.env.local`:
- API keys, base URLs, integration IDs
- Niche keywords, posting preferences
- File paths for memory files

**Memory file initialization** (6 files in `memory/`):
- `TRENDING-NOW.md` — Virlo trend data (refreshed each cycle)
- `FORMAT-WINNERS.md` — Slide formats ranked by save rate
- `HASHTAG-BANK.md` — Hashtags with real performance numbers
- `LESSONS-LEARNED.md` — What worked/flopped
- `EXPERIMENT-LOG.md` — A/B test history
- `POST-TRACKER.md` — Maps postId → hook style, format, hashtags (for analytics correlation)

**Dependencies:** Only `dotenv` + `tsx` (already installed). Native `fetch` for HTTP. `fs/promises` for file I/O.

---

### Step 2: Virlo Trend Research Module
**File:** `src/research.ts`

**Function: `runResearch()`**
1. **Create Orbit search** — `POST /v1/orbit` with niche keywords
2. **Poll until complete** — `GET /v1/orbit/:id` every 30s (0 credits)
3. **Pull top videos** — `GET /v1/orbit/:id/videos?platforms=tiktok&order_by=views&limit=20`
4. **Pull outlier creators** — `GET /v1/orbit/:id/creators/outliers?platform=tiktok&order_by=outlier_ratio&limit=20`
5. **Pull trending hashtags** — `GET /v1/hashtags?order_by=views&sort=desc&limit=30` (7-day window)
6. **Pull daily trends** — `GET /v1/trends/digest`
7. **Pull video digest** — `GET /v1/videos/digest` (last 48h top performers)

**Output actions:**
- Write `memory/TRENDING-NOW.md` with: top topics, top videos (title, views, hook text), AI analysis report
- Update `memory/HASHTAG-BANK.md` with: new hashtags discovered + view counts
- Log outlier creator formats to `memory/FORMAT-WINNERS.md` if new patterns detected

**For each outlier video, extract:**
- Slide count, text-heavy vs visual, hook slide text
- CTA placement, content type (list/story/comparison/hot take)

**Error handling:** If Orbit takes >15 min, fall back to just hashtags + video digest.

---

### Step 3: Hook & Caption Generator
**File:** `src/content-generator.ts`

**Function: `generateContent(): { hookSlide, slides, caption, hashtags, hookStyle, experiment }`**

**Input:** Reads all 5 memory files to inform decisions.

**Hook generation using Henry framework (Picture → Promise → Prove → Push):**

| Hook Style | Example | When to use |
|------------|---------|-------------|
| Question | "Did you know this AI tool can...?" | High comment driver |
| Bold claim | "This changed everything about productivity" | Attention grabber |
| Story opener | "I tried 50 AI tools and only 3 were worth it" | Engagement + watch time |
| Stat-lead | "97% of people don't know about this free AI tool" | Authority + curiosity |
| Contrast | "Stop using ChatGPT for this — use THIS instead" | Controversy + saves |

**A/B testing logic:**
1. Read `EXPERIMENT-LOG.md` for current experiment
2. If no active experiment, create one (pick 2 hook styles, assign to next 2 posts)
3. Alternate between variants for fair comparison
4. After both variants have 48h of data, declare winner

**Slide content structure (5-8 slides):**
- Slide 1: Hook (bold text, eye-catching background)
- Slides 2-6: Content (one key point per slide, matching style)
- Slide 7: Social proof or surprising stat
- Last slide: CTA ("Follow for more AI tips" + app reference if applicable)

**Caption format:** `[Hook text] [2-3 sentences expanding] [3-5 hashtags from HASHTAG-BANK.md]`

**Output:** Returns structured object with all content + metadata for tracking.

---

### Step 4: Image Generation + Video Compilation
**Files:** `src/image-generator.ts`, `src/video-compiler.ts`

**`src/image-generator.ts` — Function: `generateSlides(content): string[]` (file paths)**

For each slide (5-8 per post):
1. Construct prompt: `"TikTok slide, vertical 9:16, [style description]. Text overlay: '[slide text]'. [visual style: clean, modern, dark background with neon accent]"`
2. Call `POST /api/v1/generate` with:
   - `selectedModel: "nano-banana-2"` (best balance of speed/quality)
   - `aspectRatio: "9:16"` (TikTok vertical)
   - `resolution: "1K"` (sufficient for mobile, saves credits)
   - `mode: "sync"` (simplest, wait for result)
3. Download image from response `images[0].url` to `assets/slides/`
4. For character consistency (Phase 2): pass previous slide URLs as `referenceImageUrls`

**Cost per post:** ~5-8 images × $0.02 = $0.10-$0.16/post

**`src/video-compiler.ts` — Function: `compileVideo(imagePaths): string` (video path)**

Uses ffmpeg to combine slide images into a video:
```bash
ffmpeg -framerate 1/3 -i slide_%d.png -c:v libx264 -pix_fmt yuv420p -vf "scale=1080:1920" output.mp4
```
- 3 seconds per slide (standard for slideshow content)
- 1080x1920 resolution (TikTok vertical)
- H.264 codec for TikTok compatibility
- No audio (user adds trending sound from TikTok drafts)

**Prerequisite:** ffmpeg must be installed (`brew install ffmpeg` on macOS).

---

### Step 5: Postiz Posting Module
**File:** `src/poster.ts`

**Function: `postDraft(videoPath, caption, settings): { postId }`**

Two API calls:
1. **Upload video** — `POST /upload` with multipart form-data
   - Read video file into Buffer
   - Create FormData with `file` field
   - Returns `{ id, path }` — path is the public HTTPS URL

2. **Create draft post** — `POST /posts` with:
   ```json
   {
     "type": "draft",
     "posts": [{
       "integration": { "id": "<TIKTOK_INTEGRATION_ID>" },
       "value": [{ "content": "<caption>", "image": [{ "id": "<upload.id>", "path": "<upload.path>" }] }],
       "settings": {
         "__type": "tiktok",
         "title": "<first 90 chars of hook>",
         "privacy_level": "PUBLIC_TO_EVERYONE",
         "duet": true, "stitch": true, "comment": true,
         "autoAddMusic": "no",
         "content_posting_method": "UPLOAD"
       }
     }]
   }
   ```

3. **Track the post** — Append to `memory/POST-TRACKER.md`:
   ```
   | postId | date | hookStyle | format | hashtags | status |
   ```

**Rate limit awareness:** Each cycle uses 2 API calls (upload + post). At 30/hr, we're well within limits for 2 posts/day.

---

### Step 6: Analytics & Performance Measurement
**File:** `src/analytics.ts`

**Function: `measurePerformance(): PerformanceReport`**

1. **Read POST-TRACKER.md** to get all post IDs from last 7 days
2. **For each post** — `GET /analytics/post/:postId?date=7`
   - Extract: views, likes, comments, shares from response labels
   - Calculate: save rate, share rate, comment rate
3. **Platform-level** — `GET /analytics/:integrationId?date=7`
   - Account growth trends, overall engagement
4. **Correlate with Virlo** — Check if hashtags used are still trending via `/v1/hashtags/:tag/performance`

**Output:** Updates each post's row in `POST-TRACKER.md` with actual metrics.

**Handling missing analytics:** Postiz sometimes returns `{"missing": true}` for recent posts. Skip posts <24h old. For posts returning missing data, note in tracker and retry next cycle.

---

### Step 7: Autoresearch-Style Optimizer
**File:** `src/optimizer.ts`

**Function: `optimize(): void`**

Adapts Karpathy's autoresearch pattern to social media:

**Core loop:** `modify strategy → create content → post → measure → keep/discard → repeat`

**Each cycle:**
1. Read `POST-TRACKER.md` + analytics data
2. Find experiment pairs (variant A vs variant B) with ≥48h of data
3. Compare save rates (primary metric):
   - If one variant wins by >20% relative: **KEEP winner, DISCARD loser**
   - If <20% difference: **INCONCLUSIVE** — need more data, continue
4. Log result to `EXPERIMENT-LOG.md`:
   ```markdown
   ## Experiment #003 — 2026-03-28
   - **Hypothesis:** Question hooks vs bold-claim hooks in AI tools niche
   - **Variant A:** "Did you know..." (question) — Post ID: abc123
   - **Variant B:** "This changes everything..." (bold claim) — Post ID: def456
   - **Metrics (48h):**
     - A: 12,400 views, 3.2% save rate, 1.1% share rate
     - B: 8,200 views, 1.8% save rate, 0.6% share rate
   - **Verdict:** WINNER: A (question). Save rate +78% relative.
   - **Action:** Promote "question" in FORMAT-WINNERS.md, deprioritize "bold claim"
   ```
5. Update `FORMAT-WINNERS.md` — Rank formats by rolling 7-day save rate
6. Update `LESSONS-LEARNED.md` �� Add new pattern insight
7. Start next experiment — Pick next 2 untested or undertested variants

**Decision rules (from @leojrr):**
- Saves and shares matter more than likes — optimize for those
- If a format consistently gets saves — make more
- If a format is flopping — stop using it, replace from outlier research
- Never post same format 3x in a row
- Comments are an algorithm signal — formats that drive comments get priority
- Max 4-5 quality posts per week (TikTok throttles low-quality volume)

**Rolling metrics dashboard** (written to `LESSONS-LEARNED.md` header):
- 7-day avg save rate, 7-day avg views, best-performing hook style, best day/time to post

---

### Step 8: Main Orchestrator
**File:** `src/cycle.ts`

**Function: `runCycle(): void`** — Called by `/loop` or `npm run cycle`

```
async function runCycle() {
  log("=== CYCLE START ===")

  // Phase 1: Measure previous posts (skip if no posts yet)
  const analytics = await measurePerformance()

  // Phase 2: Optimize based on data
  await optimize()

  // Phase 3: Research current trends
  const trends = await runResearch()

  // Phase 4: Generate content (informed by all memory files)
  const content = await generateContent()

  // Phase 5: Generate slide images
  const slidePaths = await generateSlides(content)

  // Phase 6: Compile into video
  const videoPath = await compileVideo(slidePaths)

  // Phase 7: Post as draft
  const { postId } = await postDraft(videoPath, content.caption, content.settings)

  // Phase 8: Track post for future analytics
  await trackPost(postId, content.metadata)

  // Phase 9: Clean up temp slide images
  await cleanup(slidePaths)

  log("=== CYCLE COMPLETE ===")
}
```

**Error handling:** Each phase wrapped in try/catch. If image gen fails, skip posting but still do research + analytics. If Virlo is down, use cached `TRENDING-NOW.md` from last cycle.

---

### Step 9: Loop Configuration
**File:** `loop-config.md`

```
/loop 8h Run the TikTok content automation cycle:
1. Read all memory files in memory/
2. Run analytics on previous posts (Postiz API)
3. Run optimizer — log A/B results, update FORMAT-WINNERS
4. Research trends (Virlo API) — update TRENDING-NOW, HASHTAG-BANK
5. Generate content: hooks (A/B variant), caption, hashtags
6. Generate 5-8 slide images (Nano Banana API)
7. Compile slides into video (ffmpeg)
8. Upload video + create TikTok draft (Postiz API)
9. Track post in POST-TRACKER.md
10. Clean up temp files
```

**Schedule:** Every 8 hours = 3 cycles/day = 1-2 drafts produced per cycle.
**Session limit:** 3-day auto-expiry. For persistent: use `/schedule` instead.
**Manual override:** `npm run cycle` to trigger one cycle outside the loop.

---

## File Structure

```
social-media-automation/
├── .env.local                    # API keys (gitignored)
├── .env.example                  # Template for required env vars
├── .gitignore
├── config.ts                     # Centralized config from env vars
├── package.json                  # Scripts: cycle, research, generate, post, analytics, optimize
├── tsconfig.json
├── loop-config.md                # /loop command instructions
├── src/
│   ├── api-client.ts             # Shared HTTP helper (auth, retry, rate limit)
│   ├── research.ts               # Virlo API — trends, hashtags, outliers
│   ├── content-generator.ts      # Hook/caption gen (Henry framework + A/B)
│   ├── image-generator.ts        # Nano Banana API — slide image generation
│   ├── video-compiler.ts         # ffmpeg — slides → video
│   ├── poster.ts                 # Postiz API — upload + draft creation
│   ├── analytics.ts              # Postiz analytics — performance measurement
│   ├── optimizer.ts              # Autoresearch A/B engine
│   └── cycle.ts                  # Main orchestrator (entry point)
├── memory/
│   ├── TRENDING-NOW.md           # Current trending topics (refreshed each cycle)
│   ├── FORMAT-WINNERS.md         # Slide formats ranked by save rate
│   ├── HASHTAG-BANK.md           # Hashtags with real performance numbers
│   ├── LESSONS-LEARNED.md        # Patterns, insights, what works/doesn't
���   ├── EXPERIMENT-LOG.md         # A/B test history with verdicts
│   └── POST-TRACKER.md           # postId → metadata mapping for analytics
└── assets/
    └── slides/                   # Temp slide images (cleaned after each cycle)
```

---

## Build Order & Dependencies

```
Step 1: Scaffolding (config.ts, api-client.ts, memory files)
   ↓
Step 2: research.ts (depends on: api-client, config)
   ↓
Step 3: content-generator.ts (depends on: memory files from step 2)
   ↓
Step 4: image-generator.ts + video-compiler.ts (depends on: content from step 3)
   ↓
Step 5: poster.ts (depends on: video from step 4)
   ↓
Step 6: analytics.ts (depends on: POST-TRACKER from step 5)
   ↓
Step 7: optimizer.ts (depends on: analytics from step 6)
   ↓
Step 8: cycle.ts (orchestrates all above)
   ↓
Step 9: loop-config.md + verification
```

---

## Verification Plan

### Phase 1: Individual module tests
Run each module in isolation with `tsx`:

1. `npm run research` — Verify Virlo returns trend data, memory files are written
2. `tsx src/image-generator.ts` — Generate 1 test slide, verify image downloads to `assets/slides/`
3. `tsx src/video-compiler.ts` — Compile test slides into video, verify `.mp4` output
4. `tsx src/poster.ts` — Upload test video + create draft, verify appears in TikTok drafts
5. `npm run analytics` — Pull stats for a known post, verify metrics parse

### Phase 2: End-to-end dry run
1. Run `npm run cycle` once manually
2. Verify full pipeline: Virlo data → content generated → images → video → draft posted
3. Check all 6 memory files are populated with real data
4. Verify `POST-TRACKER.md` has new entry

### Phase 3: Loop test
1. Run `/loop 30m` for 2-3 cycles
2. Verify each cycle produces a new draft post
3. Verify `EXPERIMENT-LOG.md` accumulates entries
4. Verify no rate limit errors (Postiz 30/hr)

### Phase 4: Self-improvement validation (after 1 week)
1. Compare rolling 7-day save rate vs first day
2. Verify `FORMAT-WINNERS.md` reflects actual performance data
3. Verify losing formats have been rotated out
4. Verify experiments are progressing (not stuck on same hypothesis)
