# Loop Configuration

```
/loop 8h npm run cycle
```

## What each cycle does:
1. **Measure** — Pull per-post metrics from ScrapeCreators + account stats
2. **Optimize** — Evaluate A/B experiments, promote winners, kill losers
3. **Research** — Virlo API: trends, hashtags, outlier creators, video digest
4. **Generate** — Create hook + slides + caption + hashtags via Gemini
5. **Image Gen** — Gemini Imagen: generate slide images (9:16, animated/photorealistic/emoji)
6. **Text Overlay** — Python script overlays stylish text on images
7. **Post** — Blotato API: upload images → create TikTok draft (`isDraft: true`)
8. **Track** — Log post metadata in POST-TRACKER.md for analytics correlation
9. **Cleanup** — Delete temp slide images

## Schedule
- Every 8 hours = 3 cycles/day
- Posts as **drafts** — user adds trending sound manually before publishing
- Session limit: 3-day auto-expiry. For persistent: use `/schedule` instead.

## Manual trigger
```bash
npm run cycle
```
