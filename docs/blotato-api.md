# Blotato API Reference

> Source: help.blotato.com + Context7 (/websites/help_blotato)
> Last updated: 2026-04-04

## Overview

Blotato is an AI content engine that can create images, videos, carousels, and infographics, and publish posts to all major social media platforms. It supports text, images, videos, reels, slideshows, carousels, threads, and stories.

## Base URL

```
https://backend.blotato.com/v2
```

## Authentication

Include your API key in the `blotato-api-key` header (NOT Authorization, NOT Bearer):

```
blotato-api-key: YOUR_API_KEY
Content-Type: application/json
```

Get your key: Settings > API > Generate API Key

**Rate Limit:** 30 requests/minute (user-level)

---

## Endpoints

### 1. List Connected Accounts

Get all connected social media accounts and their IDs.

```
GET /users/me/accounts
```

Optional filter by platform:
```
GET /users/me/accounts?platform=tiktok
```

```bash
curl -H "blotato-api-key: YOUR_API_KEY" \
  https://backend.blotato.com/v2/users/me/accounts
```

**Response:** Array of account objects with `accountId`, platform, name, etc.

---

### 2. Create / Publish Post

```
POST /posts
```

The main endpoint for posting to any platform. Supports immediate publish, scheduled, and next-free-slot.

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `post.accountId` | string | Yes | Account ID from `/users/me/accounts` |
| `post.content.text` | string | Yes | Post text/caption |
| `post.content.mediaUrls` | string[] | No | Array of public media URLs (images/videos). Use `[]` for text-only |
| `post.content.platform` | string | Yes | `"twitter"`, `"instagram"`, `"linkedin"`, `"facebook"`, `"tiktok"`, `"pinterest"`, `"threads"`, `"bluesky"`, `"youtube"` |
| `post.content.additionalPosts` | array | No | For threads — array of `{text, mediaUrls}` objects |
| `post.target.targetType` | string | Yes | Must match `platform` |
| `post.target.pageId` | string | No | For Facebook/LinkedIn pages |
| `scheduledTime` | string | No | ISO 8601 datetime (root level, NOT inside post) |
| `useNextFreeSlot` | boolean | No | Auto-schedule to next calendar slot (root level) |

#### TikTok-Specific Target Fields

| Field | Type | Description |
|-------|------|-------------|
| `post.target.privacyLevel` | string | `"PUBLIC_TO_EVERYONE"`, `"FRIENDS_ONLY"`, etc. |
| `post.target.disabledComments` | boolean | Disable comments |
| `post.target.disabledDuet` | boolean | Disable duets |
| `post.target.disabledStitch` | boolean | Disable stitches |
| `post.target.isBrandedContent` | boolean | Paid partnership flag |
| `post.target.isYourBrand` | boolean | Own brand promotion |
| `post.target.isAiGenerated` | boolean | AI-generated content flag |
| `post.target.isDraft` | boolean | **Save as TikTok draft** — appears in TikTok app notifications/inbox, NOT in Drafts folder. User finalizes + publishes from TikTok app. |
| `post.target.autoAddMusic` | boolean | Auto-add trending music to photo posts (default: false) |
| `post.target.title` | string | Post title (max 90 chars for photo posts) |
| `post.target.imageCoverIndex` | number | Index of image to use as carousel cover |
| `post.target.videoCoverTimestamp` | number | Timestamp in ms for video cover frame |

#### Example: Publish to TikTok Immediately

```json
{
  "post": {
    "accountId": "98435",
    "content": {
      "text": "Tips for productivity #studytok #studyhacks",
      "mediaUrls": ["https://example.com/video.mp4"],
      "platform": "tiktok"
    },
    "target": {
      "targetType": "tiktok",
      "privacyLevel": "PUBLIC_TO_EVERYONE",
      "disabledComments": false,
      "disabledDuet": false,
      "disabledStitch": false,
      "isBrandedContent": false,
      "isYourBrand": false,
      "isAiGenerated": true
    }
  }
}
```

#### Example: Schedule Post

```json
{
  "post": {
    "accountId": "98435",
    "content": {
      "text": "Scheduled study tips!",
      "mediaUrls": ["https://example.com/video.mp4"],
      "platform": "tiktok"
    },
    "target": {
      "targetType": "tiktok",
      "isAiGenerated": true
    }
  },
  "scheduledTime": "2026-04-05T10:00:00Z"
}
```

#### Example: Use Next Free Calendar Slot

```json
{
  "post": {
    "accountId": "98435",
    "content": {
      "text": "Auto-scheduled post",
      "mediaUrls": [],
      "platform": "twitter"
    },
    "target": {
      "targetType": "twitter"
    }
  },
  "useNextFreeSlot": true
}
```

#### Example: Create Thread (Twitter/Threads/Bluesky)

```json
{
  "post": {
    "accountId": "98432",
    "content": {
      "text": "Thread about study tips (1/3)",
      "mediaUrls": [],
      "platform": "twitter",
      "additionalPosts": [
        { "text": "Active recall is the #1 study method (2/3)", "mediaUrls": [] },
        { "text": "Try MinuteWise for AI notes (3/3)", "mediaUrls": [] }
      ]
    },
    "target": {
      "targetType": "twitter"
    }
  }
}
```

#### Response

```json
{
  "postSubmissionId": "ps_abc123",
  "status": "queued"
}
```

**Status values:** `queued`, `processing`, `published`, `failed`

---

### 3. Check Post Status

Poll the status of a submitted post.

```
GET /posts/{postSubmissionId}
```

**Response:**

```json
{
  "status": "published",
  "result": {
    "postId": "post-789",
    "url": "https://twitter.com/user/status/12345"
  }
}
```

**Status values:** `in-progress`, `published`, `scheduled`, `failed`

If failed, check `errorMessage` in response. Also viewable at https://my.blotato.com/failed

---

### 4. Create Video from Template

Generate videos/carousels/infographics from Blotato templates using AI prompts or manual inputs.

```
POST /videos/from-templates
```

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `templateId` | string | Yes | Template ID (from list templates endpoint) |
| `inputs` | object | No | Manual field values for the template |
| `prompt` | string | No | AI prompt to auto-generate content for template |
| `render` | boolean | Yes | Set `true` to start rendering |

#### Example: AI-Prompted Carousel

```json
{
  "templateId": "5903b592-1255-43b4-b9ac-f8ed7cbf6a5f",
  "inputs": {},
  "prompt": "Create a 5-slide carousel about productivity tips for students. Use a modern style with blue tones.",
  "render": true
}
```

#### Example: Manual Slide Inputs

```json
{
  "templateId": "5903b592-1255-43b4-b9ac-f8ed7cbf6a5f",
  "inputs": {
    "slides": [
      {
        "imageSource": "https://example.com/image1.jpg",
        "textOverlay": "Slide 1: Introduction"
      },
      {
        "imageSource": "A serene mountain landscape at sunset",
        "textOverlay": "Slide 2: AI-generated image"
      }
    ],
    "textPosition": "center",
    "aiImageModel": "replicate/recraft-ai/recraft-v3"
  },
  "render": true
}
```

#### Example: AI Story Video with Scenes

```json
{
  "templateId": "/base/v2/ai-story-video/5903fe43/v1",
  "inputs": {
    "scenes": [
      {
        "mediaSource": "https://example.com/uploaded-video.mp4",
        "script": "Introduction using uploaded footage."
      },
      {
        "mediaSource": "A futuristic cityscape with flying cars",
        "script": "Now imagine what the future could look like."
      }
    ],
    "voiceName": "Daniel (British, authoritative)",
    "aspectRatio": "9:16"
  },
  "render": true
}
```

#### Response

```json
{
  "id": "vid_12345",
  "status": "queued"
}
```

---

### 5. Check Visual Creation Status

Poll the status of a video/image generation job.

```
GET /videos/creations/{VIDEO_ID}
```

**Response:**

```json
{
  "status": "done",
  "mediaUrl": "https://cdn.blotato.com/videos/generated/your-video.mp4",
  "imageUrls": ["https://cdn.blotato.com/images/slide1.png", "..."]
}
```

**Status progression:**
1. `queueing` → waiting to be processed
2. `generating-script` → AI generating script
3. `script-ready` → script done, generating media
4. `generating-media` → creating images/video
5. `media-ready` → media done, exporting
6. `exporting` → final export
7. `done` → complete — use `mediaUrl` or `imageUrls`
8. `creation-from-template-failed` → generation failed

---

### 6. Upload Media (URL or base64)

Upload media to Blotato's own CDN from a public URL **or** a base64-encoded data URL. Returns a hosted URL usable in `post.content.mediaUrls`.

```
POST /media
```

**Request Body:**

```json
{
  "url": "https://example.com/image.png"
}
```

**Or with base64 data URL (for local files, no external host required):**

```json
{
  "url": "data:image/png;base64,iVBORw0KGgo..."
}
```

**Response (201):**

```json
{
  "url": "https://database.blotato.io/storage/v1/object/public/public_media/<account>/<id>.png",
  "id": "94e99d83-166e-4dd8-ac76-6f5cda300bff"
}
```

**Notes:**
- Rate limit: **10 requests / minute** (media endpoint is stricter than the 30/min global).
- Max file size: 1GB.
- Accepts MIME types: `image/png`, `image/jpeg`, `video/mp4`, etc.
- For Google Drive URLs, use the `drive.usercontent.google.com/download?id=...&export=download&confirm=t` form.
- The returned `url` is stable and publicly accessible — pass it into `mediaUrls` for `/v2/posts`.

---

### 7. List Templates

Get available templates for visual content creation.

```
GET /templates
```

Optional filter: `?type=infographic` or `?type=carousel` or `?type=video`

**Response:**

```json
{
  "templates": [
    {
      "id": "tpl_inf_001",
      "name": "Modern Infographic",
      "type": "infographic"
    },
    {
      "id": "tpl_car_002",
      "name": "Motivational Quotes Carousel",
      "type": "carousel"
    }
  ]
}
```

---

## Supported Platforms

| Platform | `platform` / `targetType` value | Notes |
|----------|-------------------------------|-------|
| Twitter/X | `"twitter"` | Supports threads via `additionalPosts` |
| Instagram | `"instagram"` | Supports `mediaType`: image, video, reel, carousel |
| Facebook | `"facebook"` | Requires `pageId` for pages |
| TikTok | `"tiktok"` | Supports privacy, duet, stitch, AI label |
| LinkedIn | `"linkedin"` | Requires `pageId` for company pages |
| Pinterest | `"pinterest"` | Requires `boardId`, optional `title` |
| Threads | `"threads"` | Supports threads via `additionalPosts` |
| Bluesky | `"bluesky"` | Supports threads via `additionalPosts` |
| YouTube | `"youtube"` | Supports `title`, `privacyStatus` |

---

## Error Handling

| Code | Description |
|------|-------------|
| 401 | Invalid or missing API key |
| 400 | Invalid JSON structure (most common failure) |
| 429 | Rate limit exceeded (30/min) |

**Debugging:** Check https://my.blotato.com/api-dashboard or https://my.blotato.com/failed for failed posts.

---

## Key Notes

- Auth header: `blotato-api-key: key` (NOT Authorization, NOT Bearer)
- Media: either pass a public URL directly in `mediaUrls`, OR upload first via **`POST /v2/media`** (accepts a public URL **or a base64 `data:image/png;base64,...` URL** in the `url` field — returns `201` with `{ url, id }` where `url` is a Blotato-hosted public URL). Rate limit: 10 req/min, max 1GB. Use base64 data URLs to upload local files with no external image host.
- Scheduling: `scheduledTime` at root level (ISO 8601)
- Drafts: `isDraft: true` in target — saves to TikTok app inbox as real TikTok draft
- Visual creation: built-in templates for videos/carousels/infographics
- TikTok settings: in `target` object
- Rate limit: 30 requests/minute
