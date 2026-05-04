# TikTok Content Posting API Reference

> Source: developers.tiktok.com + Context7 (/websites/developers_tiktok_doc)
> Last updated: 2026-04-03

## Base URL

```
https://open.tiktokapis.com/v2
```

## Authentication

All requests require a User Access Token via Bearer auth:

```
Authorization: Bearer {UserAccessToken}
Content-Type: application/json; charset=UTF-8
```

**Required Scopes:**
- `video.publish` — for direct posting
- `video.upload` — for media upload mode

---

## Endpoints

### 1. Initialize Video Post (Direct Post)

```
POST /v2/post/publish/video/init/
```

Starts a video posting flow. Two source modes: pull from URL or chunked file upload.

#### Request Body

```json
{
  "post_info": {
    "title": "this will be a funny #cat video on your @tiktok #fyp",
    "privacy_level": "PUBLIC_TO_EVERYONE",
    "disable_duet": false,
    "disable_stitch": false,
    "disable_comment": false,
    "video_cover_timestamp_ms": 1000,
    "brand_content_toggle": false,
    "brand_organic_toggle": false,
    "is_aigc": true
  },
  "source_info": {
    "source": "PULL_FROM_URL",
    "video_url": "https://example.com/video.mp4"
  }
}
```

#### post_info Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Video caption. Max 2200 UTF-16 runes |
| `privacy_level` | string | Yes | `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY` |
| `disable_duet` | boolean | No | Disable duets |
| `disable_stitch` | boolean | No | Disable stitches |
| `disable_comment` | boolean | No | Disable comments |
| `video_cover_timestamp_ms` | integer | No | Cover frame timestamp in ms (defaults to first frame) |
| `brand_content_toggle` | boolean | Yes | `true` if paid partnership |
| `brand_organic_toggle` | boolean | No | `true` if promoting own business |
| `is_aigc` | boolean | No | `true` if AI-generated content (defaults to `false`) |

#### source_info Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | Yes | `PULL_FROM_URL` or `FILE_UPLOAD` |
| `video_url` | string | If PULL_FROM_URL | Publicly accessible video URL |
| `video_size` | integer | If FILE_UPLOAD | File size in bytes |
| `chunk_size` | integer | No | Chunk size in bytes (for chunked upload) |
| `total_chunk_count` | integer | No | Total number of chunks |

#### Response

```json
{
  "data": {
    "publish_id": "v_pub_url~v2-1.123456789"
  },
  "error": {
    "code": "ok",
    "message": "",
    "log_id": "202210112248442CB9319E1FB30C1073F3"
  }
}
```

For `FILE_UPLOAD`, response also includes `upload_url` for the next step.

---

### 2. Upload Video File (Chunked Upload)

```
PUT {upload_url from init response}
```

Used after init with `FILE_UPLOAD` source.

#### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `video/mp4`, `video/quicktime`, or `video/webm` |
| `Content-Length` | Byte size of current chunk |
| `Content-Range` | `bytes {FIRST_BYTE}-{LAST_BYTE}/{TOTAL_BYTE_LENGTH}` |

#### Example

```bash
curl --location --request PUT \
  'https://open-upload.tiktokapis.com/upload/?upload_id=67890&upload_token=Xza123' \
  --header 'Content-Range: bytes 0-30567099/30567100' \
  --header 'Content-Length: 30567100' \
  --header 'Content-Type: video/mp4' \
  --data '@/path/to/file/example.mp4'
```

---

### 3. Initialize Photo/Slideshow Post

```
POST /v2/post/publish/content/init/
```

Post photos as a TikTok slideshow. Up to **35 images** per post. Images must be **publicly accessible URLs**.

#### Request Body

```json
{
  "media_type": "PHOTO",
  "post_mode": "DIRECT_POST",
  "post_info": {
    "title": "Study tips that changed my life",
    "description": "Here are 7 study hacks you need to try #studytok #fyp",
    "privacy_level": "PUBLIC_TO_EVERYONE",
    "disable_comment": false,
    "auto_add_music": true,
    "brand_content_toggle": false,
    "brand_organic_toggle": false
  },
  "source_info": {
    "source": "PULL_FROM_URL",
    "photo_cover_index": 0,
    "photo_images": [
      "https://example.com/slide1.png",
      "https://example.com/slide2.png",
      "https://example.com/slide3.png",
      "https://example.com/slide4.png",
      "https://example.com/slide5.png",
      "https://example.com/slide6.png",
      "https://example.com/slide7.png",
      "https://example.com/slide8.png"
    ]
  }
}
```

#### Top-Level Fields

| Field | Type | Required | Value |
|-------|------|----------|-------|
| `media_type` | string | Yes | Must be `"PHOTO"` |
| `post_mode` | string | Yes | `"DIRECT_POST"` (publishes immediately) or `"MEDIA_UPLOAD"` (sends to user's TikTok inbox as draft — requires TikTok app v31.8+) |

#### post_info Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Post title. Max **90** UTF-16 runes |
| `description` | string | No | Post description. Max **4000** UTF-16 runes |
| `privacy_level` | string | Yes (DIRECT_POST) | `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY` |
| `disable_comment` | boolean | No | Disable comments |
| `auto_add_music` | boolean | No | Auto-add recommended music |
| `brand_content_toggle` | boolean | Yes (DIRECT_POST) | Paid partnership flag |
| `brand_organic_toggle` | boolean | Yes (DIRECT_POST) | Own business promotion flag |

#### source_info Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | Yes | Only `"PULL_FROM_URL"` supported |
| `photo_images` | string[] | Yes | Array of public image URLs (max **35**) |
| `photo_cover_index` | integer | Yes | Index (0-based) of cover image |

#### Response

```json
{
  "data": {
    "publish_id": "p_pub_url~v2.123456789"
  },
  "error": {
    "code": "ok",
    "message": "",
    "log_id": "202210112248442CB9319E1FB30C1073F3"
  }
}
```

---

### 4. Check Publish Status

```
POST /v2/post/publish/status/fetch/
```

Poll this endpoint to check if a post has been published.

#### Request Body

```json
{
  "publish_id": "v_pub_url~v2-1.123456789"
}
```

#### Response

```json
{
  "data": {
    "status": "PROCESSING"
  },
  "error": {
    "code": "ok",
    "message": "",
    "log_id": "20230101120000ABCDEF012345"
  }
}
```

**Status values:**
- `PROCESSING_UPLOAD` — file upload in progress
- `PROCESSING_DOWNLOAD` — downloading from URL
- `SEND_TO_USER_INBOX` — sent to creator's TikTok inbox (MEDIA_UPLOAD mode draft)
- `PUBLISH_COMPLETE` — published successfully
- `FAILED` — error occurred

---

### 5. Query Creator Info

```
POST /v2/post/publish/creator_info/query/
```

Use this before posting to get the creator's allowed `privacy_level_options`. The privacy level in your post **must** match one of the returned options.

---

## Research API (Analytics)

### Query Videos

```
POST /v2/research/video/query/
```

Search for videos with filters. Requires Research API access.

```json
{
  "query": {
    "and": [
      { "operation": "IN", "field_name": "region_code", "field_values": ["US"] },
      { "operation": "EQ", "field_name": "keyword", "field_values": ["study tips"] }
    ]
  },
  "start_date": "20250101",
  "end_date": "20250401",
  "max_count": 20,
  "fields": "id,video_description,create_time,region_code,share_count,view_count,like_count,comment_count,music_id,username"
}
```

### Video Metrics Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | int64 | Unique video ID |
| `create_time` | int64 | UTC Unix timestamp |
| `username` | string | Creator username |
| `video_description` | string | Video caption |
| `like_count` | int64 | Likes |
| `comment_count` | int64 | Comments |
| `share_count` | int64 | Shares |
| `view_count` | int64 | Views |
| `favorites_count` | int64 | Favorites/saves |
| `video_duration` | int64 | Duration in seconds |
| `hashtag_names` | string[] | Hashtags used |
| `music_id` | int64 | Music track ID |
| `region_code` | string | 2-letter country code |
| `is_stem_verified` | boolean | High quality STEM content flag |

---

## Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 400 | `invalid_param` | Check error message for details |
| 400 | `too_many_posts` | Spam risk — too many posts |
| 400 | `user_banned_from_posting` | User is banned |
| 400 | `reached_active_user_cap` | Active user cap reached |
| 400 | `unaudited_client_can_only_post_to_private_accounts` | Unaudited app limitation |
| 400 | `privacy_level_option_mismatch` | Privacy level doesn't match creator's options |
| 400 | `url_ownership_unverified` | URL ownership not verified |
| 401 | `access_token_invalid` | Token expired or invalid |
| 401 | `scope_not_authorized` | Missing required scope |
| 403 | Forbidden | Insufficient permissions |
| 429 | Rate limit | Too many requests |
| 5xx | Server error | TikTok server issue — retry later |

---

## Important Notes for This Project

- **Photo slideshow posts** use `/v2/post/publish/content/init/` (NOT the video endpoint)
- Images must be **publicly accessible URLs** — upload to tmpfiles.org first, then pass URLs to Blotato
- Max **35 images** per slideshow post
- `auto_add_music: true` to let TikTok add background music
- Always query **creator info** first to get valid `privacy_level_options`
- `is_aigc: true` on video posts / AI disclosure on photo posts for compliance
- `brand_content_toggle` and `brand_organic_toggle` are **required** for DIRECT_POST mode
- Title max: 90 chars (photo) / 2200 chars (video)
- Description max: 4000 chars (photo only)

---

## Posting Flow Summary

### For Slideshow (This Project's Primary Use):
1. Generate images → upload to tmpfiles.org → get public URLs → pass to Blotato
2. `POST /v2/post/publish/content/init/` with `media_type: "PHOTO"`, `post_mode: "DIRECT_POST"`, and image URLs
3. `POST /v2/post/publish/status/fetch/` to confirm success

### For Video:
1. `POST /v2/post/publish/video/init/` with `source: "PULL_FROM_URL"` or `"FILE_UPLOAD"`
2. If FILE_UPLOAD: `PUT {upload_url}` with video binary
3. `POST /v2/post/publish/status/fetch/` to confirm success
