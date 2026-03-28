# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous TikTok content engine that researches trends, generates slide content, posts drafts, tracks performance, and self-improves using an A/B testing loop. Designed to run unattended via Claude Code's `/loop` command.

## Commands

```bash
npm run cycle      # Run one full automation cycle (research → generate → post → analyze)
npm run research   # Virlo trend research only
npm run generate   # Content generation only
npm run post       # Post to TikTok only
npm run analytics  # Pull performance metrics only
npm run optimize   # Run A/B optimizer only
```

All scripts use `tsx` to run TypeScript directly (no build step needed).

## Architecture

**Pipeline flow:** `research.ts → content-generator.ts → image-generator.ts → video-compiler.ts → poster.ts → analytics.ts → optimizer.ts`

Orchestrated by `src/cycle.ts`, which runs all phases sequentially in a single cycle.

### External APIs

| Service | Base URL | Auth Header | Purpose |
|---------|----------|-------------|---------|
| Virlo | `https://api.virlo.ai/v1` | `Authorization: Bearer virlo_tkn_<key>` | Trend analysis, hashtags, outlier creators |
| Postiz | `https://api.postiz.com/public/v1` | `Authorization: <key>` (no Bearer!) | TikTok posting + analytics |
| Nano Banana | `https://www.nananobanana.com/api/v1` | `Authorization: Bearer nb_<key>` | Image generation (Gemini-based) |

**Postiz quirk:** Auth header uses raw API key without "Bearer" prefix, unlike the other two services.

### Memory Files (`memory/`)

Markdown files that persist state across cycles. Claude Code reads and updates these each run:

- `TRENDING-NOW.md` — Current trending topics from Virlo (refreshed each cycle)
- `FORMAT-WINNERS.md` — Slide formats ranked by save rate
- `HASHTAG-BANK.md` — Hashtags with real performance numbers
- `LESSONS-LEARNED.md` — Patterns and insights from past posts
- `EXPERIMENT-LOG.md` — A/B test history with verdicts
- `POST-TRACKER.md` — Maps postId to metadata (hook style, format, hashtags) for analytics correlation

### Key Design Decisions

- **Posts as drafts:** TikTok posts are created as drafts via Postiz so the user can manually add trending sounds before publishing. Silent slideshows get suppressed by the algorithm.
- **Virlo Orbit is async:** `POST /v1/orbit` returns immediately; poll `GET /v1/orbit/:id` every 30s until status is `completed` (2-10 min). Polling is free.
- **Nano Banana images expire in 15 days:** Download generated images immediately to `assets/slides/`.
- **Video compilation requires ffmpeg:** Slides are stitched into a 1080x1920 MP4 at 3 seconds per slide using ffmpeg.
- **A/B optimizer uses autoresearch pattern:** Modify content strategy → post → measure after 48h → keep winners, discard losers → repeat.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```
VIRLO_API_KEY=virlo_tkn_...
POSTIZ_API_KEY=...
NANO_BANANA_API_KEY=nb_...
TIKTOK_INTEGRATION_ID=...
```

Config is centralized in `config.ts` which reads from env vars via `dotenv/config`.

## Autonomous Operation

```
/loop 8h npm run cycle
```

Runs every 8 hours (3x/day). Session-tied with 3-day auto-expiry. For persistent operation, use `/schedule` instead.
