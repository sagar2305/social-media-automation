# Virlo API Reference

> Source: dev.virlo.ai/docs/orbit
> Last updated: 2026-04-08

## Base URL

```
https://api.virlo.ai/v1
```

## Authentication

```
Authorization: Bearer virlo_tkn_<your_key>
```

## CRITICAL: All responses are wrapped in `{ "data": { ... } }`

Every Virlo API response wraps the payload in a `data` field. Always access `response.data` first.

---

## Orbit Endpoints (Async Social Listening)

### `POST /v1/orbit` — Queue Keyword Search ($0.50)

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Search job name |
| `keywords` | string[] | Yes | 1-10 keywords |
| `time_period` | string | Yes | `today`, `this_week`, `this_month`, `this_year` |
| `platforms` | string[] | No | `youtube`, `tiktok`, `instagram` (defaults to all) |
| `min_views` | int | No | Minimum view threshold |
| `run_analysis` | boolean | No | Enable AI analysis report |

**Response:**
```json
{ "data": { "orbit_id": "uuid", "status": "queued", "message": "..." } }
```

### `GET /v1/orbit/:orbit_id` — Poll Status (free)

| Param | Type | Description |
|-------|------|-------------|
| `order_by` | string | `views`, `likes`, `shares`, `comments`, `bookmarks`, `publish_date` |
| `sort` | string | `asc` or `desc` (default: `desc`) |

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "status": "queued|processing|completed|failed",
    "name": "...",
    "keywords": ["..."],
    "analysis": "markdown string (if run_analysis was true)",
    "results": { "total_videos": 30, "videos": [...], "trends": [...] }
  }
}
```

Status flow: `queued → processing → completed/failed`. Poll every 30s. Typically 2-10 min.

### `GET /v1/orbit/:orbit_id/videos` — Get Videos (free)

| Param | Type | Description |
|-------|------|-------------|
| `limit` | int | 1-100 (default: 50) |
| `page` | int | 1-indexed |
| `platforms` | string | Comma-separated: `youtube,tiktok,instagram` |
| `order_by` | string | `views`, `publish_date`, `created_at` |
| `sort` | string | `asc` or `desc` |

**Response:**
```json
{
  "data": {
    "orbit_id": "...",
    "total": 30,
    "videos": [
      {
        "id": "...", "url": "https://tiktok.com/...", "description": "...",
        "platform": "tiktok", "views": 3758333, "likes": 18222,
        "shares": 384, "comments": 24, "bookmarks": 3012,
        "publish_date": "2026-04-01T...",
        "author": { "username": "...", "followers": 1000, "verified": false },
        "hashtags": ["studytips", "..."]
      }
    ]
  }
}
```

### `GET /v1/orbit/:orbit_id/creators/outliers` — Get Outlier Creators (free)

| Param | Type | Description |
|-------|------|-------------|
| `platform` | string | `youtube`, `tiktok`, or `instagram` |
| `order_by` | string | `outlier_ratio`, `avg_views`, `follower_count` |
| `sort` | string | `asc` or `desc` |
| `limit` | int | 1-100 (default: 50) |

**Response:**
```json
{
  "data": {
    "outliers": [
      {
        "creator_url": "...", "follower_count": 500, "avg_views": 50000,
        "outlier_ratio": 100.0, "videos_analyzed": 5,
        "creator_topics": ["study tips"], "platform": "tiktok",
        "videos": [{ "id": "...", "views": 100000, "likes": 5000, "hashtags": ["..."] }]
      }
    ]
  }
}
```

---

## Trends Endpoints

### `GET /v1/trends` — Get Trending Topics ($0.25 / 25 credits)

| Param | Type | Description |
|-------|------|-------------|
| `platform` | string | `youtube`, `tiktok`, `instagram` |
| `region` | string | Geographic region |

### `GET /v1/trends/digest` — Today's Trend Digest ($0.25 / 25 credits)

**Response:**
```json
{
  "data": [
    {
      "title": "Trends for Apr 8",
      "trends": [
        {
          "ranking": 1,
          "trend": {
            "name": "Angel Reese Traded",
            "description": "WNBA star traded to Atlanta Dream..."
          }
        }
      ]
    }
  ]
}
```

Note: Trends are nested as `trend.trend.name` / `trend.trend.description`.

---

## Hashtag Endpoints

### `GET /v1/hashtags` — All-Platform Hashtag Stats ($0.05 / 5 credits)

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `start_date` | string | Yes | YYYY-MM-DD |
| `end_date` | string | Yes | YYYY-MM-DD (max 90 days from start) |
| `limit` | int | No | 1-100 (default: 50) |
| `order_by` | string | No | `count` or `views` (default: `count`) |
| `sort` | string | No | `asc` or `desc` (default: `desc`) |

**Response:**
```json
{ "data": [{ "hashtag": "#studytips", "count": 4618, "total_views": 7677774631 }] }
```

### `GET /v1/tiktok/hashtags` — TikTok-Specific Hashtag Stats ($0.05)

Same params as `/v1/hashtags`.

### `GET /v1/hashtags/:hashtag/performance` — Hashtag Performance ($0.05)

| Param | Type | Description |
|-------|------|-------------|
| `start_date` | string | YYYY-MM-DD |
| `end_date` | string | YYYY-MM-DD |

---

## Video Digest

### `GET /v1/videos/digest` — 48h Top Videos

**Response:**
```json
{
  "data": [
    {
      "url": "https://tiktok.com/...", "views": 19226125,
      "number_of_likes": 853645, "description": "...",
      "hashtags": ["..."], "type": "tiktok",
      "transcript_raw": "..."
    }
  ]
}
```

---

## Pricing

| Endpoint | Credits | Cost |
|----------|---------|------|
| `POST /v1/orbit` | 50 | $0.50 |
| `GET /v1/orbit/:id` (poll) | 0 | Free |
| `GET /v1/orbit/:id/videos` | 0 | Free |
| `GET /v1/orbit/:id/creators/outliers` | 0 | Free |
| `GET /v1/trends` | 25 | $0.25 |
| `GET /v1/trends/digest` | 25 | $0.25 |
| `GET /v1/hashtags` | 5 | $0.05 |
| `GET /v1/tiktok/hashtags` | 5 | $0.05 |
| `GET /v1/hashtags/:tag/performance` | 5 | $0.05 |

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Invalid parameters |
| 401 | Missing or invalid API key |
| 402 | Insufficient balance |
| 429 | Rate limit exceeded |
