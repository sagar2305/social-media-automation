# ScrapeCreators API Documentation

> **Docs:** https://docs.scrapecreators.com
> **Dashboard:** https://app.scrapecreators.com
> **Support:** support@scrapecreators.com

## Base URL

```
https://api.scrapecreators.com
```

## Authentication

```
x-api-key: YOUR_API_KEY
```

**Cost:** 1 credit per request (profile costs 1, video costs 1, audience demographics costs 26).

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Invalid parameters |
| 401 | Invalid/missing API key |
| 402 | Insufficient credits |
| 500 | Server error |

---

## Key Endpoints

### `GET /v2/tiktok/video` — Video Info + Metrics

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | Full TikTok video URL |
| `trim` | boolean | No | Trimmed response (recommended) |
| `get_transcript` | boolean | No | Include video transcript |
| `region` | string | No | 2-letter country code (e.g. `PH`, `US`) for geo-restricted videos |

```bash
curl "https://api.scrapecreators.com/v2/tiktok/video?url=https://www.tiktok.com/@user/video/123&trim=true" \
  -H "x-api-key: YOUR_KEY"
```

**Response:**
```json
{
  "aweme_detail": {
    "aweme_id": "123",
    "desc": "Video description",
    "create_time": 1640966400,
    "statistics": {
      "play_count": 50000,
      "digg_count": 2000,
      "collect_count": 500,
      "share_count": 100,
      "comment_count": 80,
      "download_count": 30
    },
    "author": {
      "uid": "...",
      "unique_id": "username",
      "nickname": "Display Name",
      "follower_count": 10000
    },
    "video": {
      "duration": 15,
      "width": 1080,
      "height": 1920,
      "play_addr": { "url_list": ["..."] },
      "download_addr": { "url_list": ["..."] },
      "cover": { "url_list": ["..."] }
    },
    "music": {
      "title": "Song Name",
      "author": "Artist",
      "duration": 30,
      "play_url": { "url_list": ["..."] }
    }
  }
}
```

**Key metrics:** `play_count` (views), `digg_count` (likes), `collect_count` (saves), `share_count`, `comment_count`, `download_count`.

---

### `GET /v1/tiktok/profile` — User Profile + Stats

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `handle` | string | Yes | TikTok username (without @) |

```bash
curl "https://api.scrapecreators.com/v1/tiktok/profile?handle=yournotetaker" \
  -H "x-api-key: YOUR_KEY"
```

**Response:**
```json
{
  "success": true,
  "credits_remaining": 98,
  "user": {
    "id": "...",
    "uniqueId": "yournotetaker",
    "nickname": "yournotetaker",
    "signature": "Bio text...",
    "avatarLarger": "https://...",
    "avatarMedium": "https://...",
    "avatarThumb": "https://..."
  },
  "stats": {
    "followerCount": 190,
    "followingCount": 358,
    "heartCount": 5888,
    "videoCount": 234,
    "diggCount": 0,
    "friendCount": 0
  }
}
```

---

### `GET /v3/tiktok/profile/videos` — User's Recent Videos

**IMPORTANT:** v1 endpoint is SUSPENDED. Must use v3.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `handle` | string | Yes | TikTok username (without @) |
| `max_cursor` | string/number | No | **Pagination cursor.** Pass the `max_cursor` value from the previous response to fetch the next page (returns posts older than that cursor). **The param name is `max_cursor` on both request and response — NOT `cursor`.** Passing `cursor=` has no effect. |
| `sort_by` | string | No | `latest` (default) or `popular` |
| `trim` | boolean | No | `true` for a lighter response (drops music/cover URLs) |
| `user_id` | string | No | TikTok user_id — faster than `handle` if known |

```bash
# Page 1
curl "https://api.scrapecreators.com/v3/tiktok/profile/videos?handle=yournotetaker" \
  -H "x-api-key: YOUR_KEY"

# Page 2 (using max_cursor from page 1's response)
curl "https://api.scrapecreators.com/v3/tiktok/profile/videos?handle=yournotetaker&max_cursor=1775658608000" \
  -H "x-api-key: YOUR_KEY"
```

**Response:**
```json
{
  "success": true,
  "credits_remaining": 72,
  "has_more": 1,
  "max_cursor": 1775658608000,
  "min_cursor": 1776254584000,
  "status_code": 0,
  "aweme_list": [
    {
      "aweme_id": "7625706970850331935",
      "desc": "Caption text...",
      "create_time": 1743983334,
      "statistics": {
        "play_count": 156,
        "digg_count": 1,
        "collect_count": 0,
        "share_count": 0,
        "comment_count": 0
      }
    }
  ]
}
```

**Pagination rule:** loop `max_cursor = response.max_cursor` until `has_more === 0` or `aweme_list.length === 0`. Each page = up to 10 videos = 1 credit. Cost scales with `ceil(accounts × pages_per_account)`.

### Other TikTok Endpoints

| Endpoint | Description |
|----------|-------------|
| ~~`GET /v1/tiktok/profile/videos`~~ | **SUSPENDED** — use `/v3/tiktok/profile/videos` instead |
| `GET /v1/tiktok/video/comments` | Video comments |
| `GET /v1/tiktok/video/comments/replies` | Comment replies |
| `GET /v1/tiktok/profile/followers` | Follower list |
| `GET /v1/tiktok/profile/following` | Following list |
| `GET /v1/tiktok/search/users` | Search users |
| `GET /v1/tiktok/search/hashtag` | Search by hashtag |
| `GET /v1/tiktok/search/keyword` | Search by keyword |
| `GET /v1/tiktok/search/top` | Top search results |
| `GET /v1/tiktok/trending` | Trending feed |
| `GET /v1/tiktok/popular/songs` | Popular songs |
| `GET /v1/tiktok/popular/creators` | Popular creators |
| `GET /v1/tiktok/popular/videos` | Popular videos |
| `GET /v1/tiktok/popular/hashtags` | Popular hashtags |
| `GET /v1/tiktok/live` | Live stream data |
| `GET /v2/tiktok/user/audience` | Audience demographics (26 credits) |
