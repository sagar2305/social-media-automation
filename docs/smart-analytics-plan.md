# Smart Analytics Fetching Plan

> **Goal:** Track post performance for 50 TikTok accounts under a $20/month ScrapeCreators budget.
> **Date:** 2026-04-09
> **Status:** Plan — not yet implemented

---

## 1. Verified Facts (from real API testing)

| Fact | Value | How verified |
|------|-------|-------------|
| `/v3/profile/videos` page size | **10 videos** | Live API call on @yournotetaker |
| Stats included in bulk response | `play_count`, `digg_count`, `collect_count`, `share_count`, `comment_count` | Confirmed in response |
| `has_more` field exists | Yes, returns `1` when more pages | Confirmed |
| Cursor pagination works | `max_cursor` timestamp-based | Tested page 1 → page 2 |
| Credit cost per page | **1 credit** | credits_remaining dropped 25000→24998 after 2 calls |
| Page 1 date coverage | ~3.3 days at 3 posts/day per account | Calculated from timestamps |
| Pages for full month | **9 pages** per account at 3 posts/day | 30 days ÷ 3.3 days/page |
| ScrapeCreators pricing | $47 for 25,000 credits ($1.88/1K), pay-as-you-go, no expiry | scrapecreators.com pricing page |
| ScrapeCreators rate limits | None on their side; self-imposed 120/hr in our code | docs + api-client.ts:19 |

---

## 2. Current System Problems

### Problem 1: Metrics fetched ONCE, then never updated
**File:** `pull_analytics.ts:274`
```typescript
(r.views === '-' || r.views === '0')  // Only fetches when views are blank/zero
```
Once a post gets ANY views, it's never checked again. A post showing 100 views on day 2 might have 2,000 views by day 14 — we'd never know. The A/B optimizer makes decisions on stale, single-snapshot data.

### Problem 2: Hashtag matching is fragile
**File:** `pull_analytics.ts:213-228`
- Matches posts to TikTok videos by counting hashtag overlaps (>= 2 matches).
- No date proximity check — a Mar 25 post could match a Apr 5 video.
- At 50 accounts, many posts share identical hashtags (`#studytips, #minutewise, #studentlife`).
- The `status === 'published'` legacy fallback (line 190) means untagged rows match against ALL accounts' videos.
- **Risk at scale:** Wrong video matched → wrong metrics → corrupted A/B tests.

### Problem 3: No concurrency protection
**File:** `pull_analytics.ts` — `readFile()` → mutate → `writeFile()`
- No file locks, no atomic writes, no temp-file-then-rename.
- Two overlapping runs (analytics + posting cycle) = last writer wins, first writer's updates silently lost.

### Problem 4: Optimizer bugs
**File:** `scripts/optimizer.ts`
- Line ~201: Winner/loser both marked `'keep'` — losers never discarded.
- Variant matching grabs the FIRST post with matching `hookStyle`, ignoring age or account.
- `refreshFormatWinners` sorts by avg views but experiments judge by save rate — inconsistent.

### Problem 5: 31% of posts are stuck "in-progress"
- 14 out of 45 tracked posts are `in-progress` (never published or failed silently).
- System checks Blotato status for ALL of these every run, forever.
- At 50 accounts, could be 200+ stuck posts consuming run time.

### Problem 6: No credit tracking
- No record of how many API calls have been made.
- No budget enforcement — system runs until credits hit zero.

### Problem 7: Run duration at scale
At current 120/hr self-imposed rate limit with 50 accounts:
| Run type | Calls | Duration |
|----------|-------|----------|
| Daily (page 1) | 50 SC + 150 Blotato | **30 min** |
| Every-3-day (pages 1-3) | 150 SC + 150 Blotato | **80 min** |
| Weekly deep (pages 1-9 + stats) | 500 SC + 150 Blotato | **4.2 hours** |

A 4-hour analytics run is not viable for a 24h loop.

---

## 3. The Plan: Bulk Tiered Fetching

### Core Idea
Use `/v3/profile/videos` (1 credit = 10 posts' metrics) instead of `/v2/tiktok/video` (1 credit = 1 post's metrics). Fetch recent posts daily, older posts less often.

### Fetch Schedule

| Tier | Post Age | Frequency | Pages/Account | Purpose |
|------|----------|-----------|---------------|---------|
| **Hot** | Days 1-3 | Daily | 1 | Algorithm test results, early signal |
| **Warm** | Days 4-10 | Every 3 days | 2 (pages 2-3) | Peak surge capture |
| **Cool** | Days 11-30 | Weekly | 6 (pages 4-9) | Plateau evaluation |
| **Archive** | 30d+ (top 20% only) | Weekly | 2-3 (pages 10-12) | Resurrection detection |
| **Account stats** | — | Weekly | — (`/v1/profile`) | Follower/like trends |

### Why This Schedule

Based on TikTok engagement research:
- **55-65% of lifetime views** happen in first 5 days → Hot + Warm tiers capture this
- **Posts plateau at day 14-16** → Cool tier catches this
- **~8% of posts resurrect later** → Archive tier for top performers only
- **TikTok analytics refresh once/day on UTC cycle** → fetching more than daily is wasted
- **Educational/study content** (our niche) has higher resurrection rate → worth monitoring

### Post Matching Strategy

**For posts WITH TikTok URLs (have `aweme_id`):**
- Extract `aweme_id` from URL: `/photo/7625706970850331935` → `7625706970850331935`
- Match directly against `aweme_id` in bulk `/v3/profile/videos` response
- Zero ambiguity, instant match

**For posts WITHOUT TikTok URLs (new/unresolved):**
- Still use hashtag matching for initial URL discovery
- ADD date proximity check: only match videos within ±3 days of tracker row date
- Once matched, switch to `aweme_id` matching for all future updates

### Archive Rules

Not every old post is worth checking. Tiered archival:

```
Post age > 30 days:
  ├─ views > account median  → "monitor" → weekly check via deep pagination
  ├─ views < median, no growth in last 2 fetches → "cold" → monthly check
  └─ "cold" for 3 consecutive months → "archived" → stop checking forever
```

This prevents the archive from growing unbounded. After 6 months with 50 accounts:
- ~27,000 total posts
- ~5,400 "monitor" (top 20%)
- ~10,800 "cold" (checked monthly, cheap)
- ~10,800 "archived" (zero cost)

### Stale Draft Handling

Posts stuck in `in-progress` for > 7 days:
- Mark as `stale` in tracker
- Stop checking Blotato for status
- If the post later appears in `/v3/profile/videos`, resurrect it automatically
- Prevents unbounded Blotato polling

---

## 4. Credit Budget

### Monthly Cost at 50 Accounts (3 posts/day each)

| Operation | Frequency | Credits/Run | Runs/Month | Credits/Month |
|-----------|-----------|-------------|------------|---------------|
| Hot tier (page 1) | Daily | 50 | 30 | 1,500 |
| Warm tier (pages 2-3) | Every 3 days | 100 | 10 | 1,000 |
| Cool tier (pages 4-9) | Weekly | 300 | 4 | 1,200 |
| Archive monitors (pages 10-12) | Weekly | 150 | 4 | 600 |
| Account stats (`/v1/profile`) | Weekly | 50 | 4 | 200 |
| Buffer (experiments, ad-hoc) | — | — | — | 500 |
| **TOTAL** | | | | **5,000** |

### Cost Breakdown

```
Monthly credits:   5,000
Cost per 1K:       $1.88 (Freelance plan)
Monthly cost:      $9.40
Budget:            $20.00
Headroom:          $10.60 (53% buffer)

One $47 pack (25K credits) lasts: ~5 months
Break-even vs $20/mo: Freelance pack is cheaper until ~130 accounts
```

### Scaling Table

| Accounts | Posts/Month | Credits/Month | Cost/Month | Under $20? |
|----------|------------|---------------|------------|------------|
| 4 (current) | 360 | ~500 | $0.94 | Yes |
| 10 | 900 | ~1,200 | $2.26 | Yes |
| 25 | 2,250 | ~2,800 | $5.26 | Yes |
| **50** | **4,500** | **~5,000** | **$9.40** | **Yes** |
| 75 | 6,750 | ~7,500 | $14.10 | Yes |
| 100 | 9,000 | ~10,000 | $18.80 | Barely |
| 106 | 9,540 | ~10,600 | $19.93 | Max |

### Worst-Case Scenario

If page size drops to 8 (TikTok API change), or posting frequency rises to 5/day:

```
Pages for 30 days: 30×5/8 = 19 pages per account (vs 9 now)
Weekly deep: 50 × 19 = 950 calls = 950 credits
Monthly: ~8,700 credits = $16.36 — still under $20
```

### Credit Safety Rails

```
MONTHLY_BUDGET = 10,600 credits ($20 worth)

Throttle levels:
  < 80% used  → normal operation (all tiers)
  80-90%      → skip archive monitors
  90-95%      → skip cool tier (pages 4-9), keep hot + warm
  > 95%       → hot tier only (page 1 daily) — bare minimum
  
Credit source: API returns `credits_remaining` in every response
  → use this as ground truth, not an internal counter
  → also maintain internal counter as backup (for monthly tracking)
```

### Priority Ladder (what to cut first)

1. Archive monitors → saves 600/month
2. Cool tier frequency (weekly → biweekly) → saves 600/month
3. Warm tier frequency (every 3 days → weekly) → saves 700/month
4. Account stats (weekly → monthly) → saves 150/month
5. **NEVER cut: Hot tier (page 1 daily)** — this is the core data

---

## 5. Run Duration Fix

### Current: 4.2 hours for weekly deep run (unacceptable)

**Root cause:** Self-imposed 120/hr rate limit in `api-client.ts:19`.
ScrapeCreators has **no rate limits** on their side.

### Solution: Raise limit + add concurrency

| Approach | Weekly Deep Duration |
|----------|---------------------|
| Current (120/hr, sequential) | 4.2 hours |
| Raise to 600/hr, sequential | 55 min |
| Raise to 600/hr, 5x concurrent | **15 min** |
| Raise to 600/hr, 10x concurrent | **8 min** |

**Recommended:** 600/hr rate limit + 5 concurrent requests.
- Daily run: ~3 min
- Every-3-day run: ~6 min
- Weekly deep run: ~15 min

### Implementation

```typescript
// api-client.ts — change from:
scrapeCreators: { requests: [], maxPerHour: 120 }
// to:
scrapeCreators: { requests: [], maxPerHour: 600 }

// Add batch helper:
async function batchRequests<T>(
  calls: (() => Promise<T>)[],
  concurrency: number = 5
): Promise<T[]> { ... }
```

---

## 6. Required Code Changes

### Change 1: Remove fetch-once filter
**File:** `pull_analytics.ts:274`
```
REMOVE: (r.views === '-' || r.views === '0')
REPLACE WITH: tier-based eligibility check using post age + last_fetched date
```

### Change 2: Add tracker columns
**File:** `pull_analytics.ts` — `TrackerRow` interface + serializer
```
New columns: | Last Fetched | Fetch Count | Tier |
```
- `Last Fetched`: ISO date of last metric update
- `Fetch Count`: number of times metrics have been pulled
- `Tier`: hot / warm / cool / monitor / cold / archived

### Change 3: aweme_id matching for bulk updates
**File:** `pull_analytics.ts` — new function `updateMetricsFromBulk()`
```
For each account:
  1. Call /v3/profile/videos (paginate as tier requires)
  2. Build map: aweme_id → statistics
  3. For each tracker row with a TikTok URL:
     - Extract aweme_id from URL
     - Look up in map
     - Update metrics if found
  4. For unresolved rows (no URL):
     - Use hashtag matching + date proximity (±3 days)
     - Once matched, store aweme_id for future direct matching
```

### Change 4: Credit tracking
**New file:** `data/CREDIT-USAGE.md`
```
Track per-run: date, operation, credits used, credits remaining (from API response)
Monthly rollup with budget % consumed
```

### Change 5: Stale draft cleanup
**File:** `pull_analytics.ts` — `checkBlotPostStatus()`
```
If post is "in-progress" and date is > 7 days ago → mark "stale", skip future checks
If stale post appears in /v3/profile/videos → resurrect as "published"
```

### Change 6: Raise rate limit + add concurrency
**File:** `api-client.ts:19`
```
scrapeCreators: { requests: [], maxPerHour: 600 }
```
Add `batchRequests()` utility for parallel API calls.

### Change 7: Concurrency guard for tracker writes
**File:** `pull_analytics.ts`
```
Use write-to-temp-file + atomic rename pattern:
  1. writeFile(trackerPath + '.tmp', data)
  2. rename(trackerPath + '.tmp', trackerPath)
Add PID-based lock file to prevent overlapping analytics runs.
```

---

## 7. Optimizer Fixes (required for plan to produce value)

The analytics data is only useful if the optimizer works correctly.

### Bug 1: Winner/loser both marked 'keep'
**File:** `optimizer.ts:~201`
```
Current:  result.winner === 'A' ? 'keep' : 'keep'  // bug
Fix:      result.winner === 'A' ? 'keep' : 'discard'
```

### Bug 2: Variant matching grabs wrong post
**File:** `optimizer.ts`
```
Current: takes FIRST post matching hookStyle
Fix: filter to posts within the experiment's date range, same account, same flow type
```

### Bug 3: Format winners sorted by views, not save rate
**File:** `optimizer.ts` — `refreshFormatWinners()`
```
Current: sorts by avg views
Fix: sort by avg save rate (consistent with experiment criterion)
```

### Consideration: Experiment evaluation timing
With tiered fetching, ensure both experiment variants have been fetched at the SAME tier level before comparing. Don't compare a post with day-2 metrics against one with day-7 metrics.

```
Rule: both variants must have fetch_count >= 2 AND last_fetched within 24h of each other
```

---

## 8. New Refresh Command

```bash
npm run refresh:smart    # replaces npm run refresh for analytics
```

### Flow

```
refresh:smart
│
├─ 1. Acquire lock (PID file). If locked, exit.
│
├─ 2. Read POST-TRACKER.md + CREDIT-USAGE.md
│     └─ Calculate budget consumed this month
│     └─ Determine throttle level
│
├─ 3. Blotato status sync (not ScrapeCreators credits)
│     ├─ Check posts without TikTok URLs (skip stale >7d)
│     └─ Mark newly published, newly stale
│
├─ 4. For each of 50 accounts (5 concurrent):
│     ├─ DAILY: /v3/profile/videos page 1
│     │   ├─ Match by aweme_id for existing posts
│     │   ├─ Resolve URLs for new posts (hashtag + date proximity)
│     │   └─ Update metrics for all matched posts
│     │
│     ├─ IF every-3-day: pages 2-3 (warm tier)
│     ├─ IF weekly: pages 4-9 (cool tier) + account stats
│     └─ IF weekly + budget allows: pages 10-12 (archive monitors)
│
├─ 5. Update POST-TRACKER.md (atomic write)
│     └─ Update last_fetched, fetch_count, tier for each row
│
├─ 6. Update CREDIT-USAGE.md
│     └─ Log: date, credits used, credits remaining, budget %
│
├─ 7. Budget guard warning
│     └─ If >80% consumed: log warning
│     └─ If >95%: emergency mode flag for next run
│
└─ 8. Release lock
```

### Schedule

```bash
# In /loop or cron:
/loop 24h npm run refresh:smart

# The script internally decides what to fetch based on:
#   - Day of month (weekly = every 7th run)
#   - Last deep fetch timestamp (stored in CREDIT-USAGE.md)
#   - Current budget consumption
```

---

## 9. Edge Cases & Mitigations

### Post deleted from TikTok
- `/v3/profile/videos` won't return it anymore
- Tracker keeps last-known metrics (don't zero them out)
- After 3 consecutive fetches where post is absent from profile, mark as `deleted`

### Account banned/suspended
- API returns error or empty `aweme_list`
- Log warning, skip account for this run
- If empty for 7+ consecutive days, flag account as `suspended` in tracker

### ScrapeCreators goes down
- API returns 500/timeout
- Retry with backoff (already implemented in api-client.ts)
- If all retries fail, run completes with partial data
- Never crash the whole refresh because one account failed

### Page size changes
- TikTok might return 8 or 15 per page instead of 10
- System must use `has_more` flag to decide pagination, not hardcoded page count
- Budget guard adapts automatically (more pages = more credits = throttle sooner)

### Posting frequency varies across accounts
- Some accounts post 1/day, others 5/day
- Page 1 covers different date ranges per account — that's fine
- The tier schedule is based on post AGE, not page number
- System should track `oldest_date_on_page` to know coverage depth

### Two runs overlap
- Lock file (PID-based) prevents concurrent analytics runs
- If lock exists and PID is alive, exit immediately
- If lock exists but PID is dead (crash), remove stale lock and proceed

### Credits run out mid-run
- Check `credits_remaining` from each API response
- If < 100 remaining, abort gracefully (save partial results)
- Never leave tracker in corrupted state (atomic writes)

### New account added (account 51)
- No posts in profile yet → empty `aweme_list` → skip, no credits wasted
- System auto-adapts as posts appear

---

## 10. What This Plan Does NOT Cover

- **Blotato API costs** — Blotato calls are separate from ScrapeCreators. This plan only budgets ScrapeCreators credits. Blotato rate limits (1800/hr) are generous and not a concern.
- **Virlo API credits** — Trend research is a separate budget. Use `--skip-research` to save those credits.
- **Gemini API costs** — Image generation costs are not part of analytics.
- **TikTok API direct access** — This plan uses ScrapeCreators as a proxy. If TikTok's official Content API becomes available for your accounts, it would be free but has different rate limits.
- **Statistical significance** — With current view counts (85-360 per post), A/B test results have low confidence. This plan improves data freshness but doesn't solve the low-traffic problem. Need more posts/accounts/time for meaningful experiments.

---

## 11. Implementation Order

1. **Fix optimizer bugs** (change 7 above) — without this, better data feeds a broken optimizer
2. **Add credit tracking** (change 4) — need visibility before scaling
3. **Raise rate limit to 600/hr** (change 6) — unblocks everything else
4. **Add aweme_id matching** (change 3) — required before scaling to 50 accounts
5. **Add tracker columns** (change 2) — `last_fetched`, `fetch_count`, `tier`
6. **Build tiered fetch logic** (change 1) — the core of the plan
7. **Add concurrency + atomic writes** (changes 6, 7) — for 50-account scale
8. **Add stale draft cleanup** (change 5) — prevents unbounded Blotato polling
9. **Wire up as `npm run refresh:smart`** — new entry point
10. **Test with 4 accounts first** — validate credit math before scaling to 50
