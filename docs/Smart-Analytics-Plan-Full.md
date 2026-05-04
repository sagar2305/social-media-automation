# Smart Analytics Fetching Plan

**MinuteWise TikTok Content Engine**
50 accounts | $20/month budget | Autonomous operation
Date: April 2026 | Status: Ready for Implementation

---

## Table of Contents

1. Goal & Current Problems
2. The Solution: Bulk Tiered Fetching
3. How Pages Work Per Account
4. Post Matching Strategy
5. Month 1: Day-by-Day Credit Usage (Days 1-30)
6. Month 2: Day-by-Day Credit Usage (Days 31-60)
7. Month 1 vs Month 2 Comparison
8. Key Milestone Days (Days 31-90)
9. Monthly Credit Budget at Scale
10. Credit Safety Rails
11. Run Duration Fix
12. Required Code Changes
13. Optimizer Bug Fixes
14. The refresh:smart Command Flow
15. Edge Cases & Mitigations
16. Implementation Order

---

## 1. Goal & Current Problems

### Goal

Track post performance for 50 TikTok accounts under a $20/month ScrapeCreators budget, with autonomous operation via Claude Code `/loop`.

### Verified Facts (from real API testing)

| Fact | Value |
|------|-------|
| `/v3/profile/videos` page size | **10 videos** per page |
| Stats included in bulk response | `play_count`, `digg_count`, `collect_count`, `share_count`, `comment_count` |
| Cursor pagination | `max_cursor` timestamp-based, `has_more` = 1 when more pages |
| Credit cost per page | **1 credit** per page (10 posts per credit) |
| Page 1 coverage | ~10 days at 1 post/day per account |
| Pages for full month | ~9 pages per account at 1 post/day |
| ScrapeCreators pricing | $47 for 25,000 credits ($1.88/1K), pay-as-you-go, no expiry |

### Problem 1: Metrics Fetched ONCE, Never Updated

**File:** `pull_analytics.ts:274`

```typescript
(r.views === '-' || r.views === '0')  // Only fetches when views are blank/zero
```

Once a post gets ANY views (even 100 on day 2), it is never checked again. A post showing 100 views on day 2 might have 2,000 views by day 14 -- we would never know. The A/B optimizer makes decisions on stale, single-snapshot data.

### Problem 2: Hashtag Matching is Fragile

**File:** `pull_analytics.ts:213-228`

- Matches posts to TikTok videos by counting hashtag overlaps (>= 2 matches)
- No date proximity check -- a Mar 25 post could match an Apr 5 video
- At 50 accounts, many posts share identical hashtags (#studytips, #minutewise, #studentlife)
- The `status === 'published'` legacy fallback means untagged rows match against ALL accounts' videos
- **Risk at scale:** Wrong video matched -> wrong metrics -> corrupted A/B tests

### Problem 3: No Concurrency Protection

**File:** `pull_analytics.ts`

- `readFile()` -> mutate -> `writeFile()` with no file locks, no atomic writes
- Two overlapping runs (analytics + posting cycle) = last writer wins, first writer's updates silently lost

### Problem 4: Optimizer Bugs

**File:** `scripts/optimizer.ts`

- Winner AND loser both marked `'keep'` -- losers never discarded
- Variant matching grabs FIRST post with matching `hookStyle`, ignoring age or account
- `refreshFormatWinners` sorts by avg views but experiments judge by save rate -- inconsistent

### Problem 5: 31% of Posts Stuck "in-progress"

- 14 out of 45 tracked posts are `in-progress` (never published or failed silently)
- System checks Blotato status for ALL of these every run, forever
- At 50 accounts, could be 200+ stuck posts consuming run time

### Problem 6: No Credit Tracking

- No record of how many API calls have been made
- No budget enforcement -- system runs until credits hit zero

### Problem 7: Run Duration at Scale

At current 120/hr self-imposed rate limit with 50 accounts:

| Run Type | Calls | Duration |
|----------|-------|----------|
| Daily (page 1) | 50 SC + 150 Blotato | 30 min |
| Every-3-day (pages 1-3) | 150 SC + 150 Blotato | 80 min |
| Weekly deep (pages 1-9 + stats) | 500 SC + 150 Blotato | **4.2 hours** |

A 4-hour analytics run is not viable for a 24h loop.

---

## 2. The Solution: Bulk Tiered Fetching

### Core Idea

Use `/v3/profile/videos` (1 credit = 10 posts' metrics) instead of `/v2/tiktok/video` (1 credit = 1 post's metrics). **10x cost reduction.** Fetch recent posts daily, older posts less often based on their age.

### The Fetch Tiers

| Tier | Post Age | Frequency | Pages/Account | Credits/Run (50 accts) | Purpose |
|------|----------|-----------|---------------|----------------------|---------|
| **Hot** | Days 1-3 | Daily | 1 (page 1) | 50 | Algorithm test results, early signal |
| **Warm** | Days 4-10 | Every 3 days | 2 (pages 2-3) | 100 | Peak surge capture |
| **Cool** | Days 11-30 | Weekly | 6 (pages 4-9) | 300 | Plateau evaluation |
| **Archive** | 30d+ (top 20%) | Weekly | 2-3 (pages 10-12) | 150 | Resurrection detection |
| **Stats** | N/A | Weekly | /v1/profile | 50 | Follower/like trends |

### Why This Schedule

- **55-65% of lifetime views** happen in first 5 days -- Hot + Warm capture this
- **Posts plateau at day 14-16** -- Cool tier catches the plateau
- **~8% of posts resurrect** after going cold -- Archive tier for top performers only
- **TikTok analytics refresh once/day** on UTC cycle -- fetching more than daily is wasted
- **Educational/study content** (our niche) has higher resurrection rate -- worth monitoring

### Key Insight: Fetching is Per ACCOUNT, Not Per Post

Page 1 returns the 10 most recent posts per API call. So:

- 50 accounts = 50 API calls = **50 credits**, regardless of total post count
- Each call returns metrics for up to 10 posts simultaneously
- **Cost scales with number of ACCOUNTS, not number of POSTS**
- 500 total posts or 5,000 total posts -- still 50 credits for the hot tier

---

## 3. How Pages Work Per Account

Each page holds 10 posts (most recent first). As new posts push old ones off each page, they land on the next page.

### Page Layout Over Time (1 post/day per account)

| Day | Page 1 | Page 2 | Page 3 | Page 4 |
|-----|--------|--------|--------|--------|
| 1 | post 1 + older | older | older | older |
| 5 | posts 1-5 + older | older | older | older |
| **10** | **posts 1-10 (FULL)** | older | older | older |
| **11** | **posts 2-11** | **post 1 falls here** | older | older |
| 15 | posts 6-15 | posts 1-5 + older | older | older |
| **20** | posts 11-20 | **posts 1-10 (FULL)** | older | older |
| 25 | posts 16-25 | posts 6-15 | posts 1-5 + old | older |
| **30** | posts 21-30 | posts 11-20 | **posts 1-10 (FULL)** | older |
| 40 | posts 31-40 | posts 21-30 | posts 11-20 | posts 1-10 |
| 60 | posts 51-60 | posts 41-50 | posts 31-40 | posts 21-30 |
| 90 | posts 81-90 | posts 71-80 | posts 61-70 | posts 51-60 |

### When Each Tier Becomes Actually Useful

| Tier | Needed From | Why | Before That |
|------|-------------|-----|-------------|
| Hot (page 1) | Day 1 | Always needed -- primary data source | Always active |
| **Warm (pages 2-3)** | **Day 11** | Posts start falling off page 1 | Fetches only pre-existing older content |
| **Cool (pages 4-9)** | **Day 31** | Posts start falling off page 3 | Fetches only pre-existing older content |
| **Archive (pages 10+)** | **Day 91** | Posts start falling off page 9 | Classification starts day 31, but pages 10+ have only old content |

**RAMP-UP NOTE:** For the first 10 days, page 1 covers ALL our posts. The warm/cool tiers run on schedule but only fetch pre-existing older content on accounts. They become essential only after posts age out of page 1.

---

## 4. Post Matching Strategy

### For Posts WITH TikTok URLs (have aweme_id)

- Extract `aweme_id` from URL: `/photo/7625706970850331935` -> `7625706970850331935`
- Match directly against `aweme_id` in bulk `/v3/profile/videos` response
- Zero ambiguity, instant match

### For Posts WITHOUT TikTok URLs (new/unresolved)

- Still use hashtag matching for initial URL discovery
- ADD date proximity check: only match videos within +/-3 days of tracker row date
- Once matched, store `aweme_id` -- switch to direct matching for all future updates
- **The fragile hashtag matching is only used ONCE per post, not forever**

### Archive Lifecycle

```
Post age > 30 days:
  |-- views > account median  -> "monitor" -> weekly check
  |-- views < median, no growth in last 2 fetches -> "cold" -> monthly check
  |-- "cold" for 3 consecutive months -> "archived" -> stop checking forever
```

After 6 months at 50 accounts (~27,000 total posts):
- ~5,400 in "monitor" (top 20%, still checked weekly)
- ~10,800 in "cold" (checked monthly, very cheap)
- ~10,800 in "archived" (zero cost forever)

### Stale Draft Handling

- Posts stuck in `in-progress` for > 7 days: mark as `stale`
- Stop checking Blotato for status (no more wasted polling)
- If the post later appears in `/v3/profile/videos`, resurrect automatically as `published`

---

## 5. Month 1: Day-by-Day Credit Usage (Days 1-30)

**Setup:** 50 accounts, 1 post/day each, 10 posts per page
**Active tiers:** Hot, Warm, Cool, Stats (NO archive -- no posts are 30+ days old yet)

### Phase 1: Ramp-Up (Days 1-10) -- Page 1 Covers Everything

During these 10 days, every single one of our posts fits on page 1. The warm and cool tiers run on schedule but only fetch pre-existing older content -- not our new posts.

| Day | Total Posts | Posts/Acct | Tiers Fired | Day Credits | Cumulative | Budget % | What's Happening |
|-----|-----------|------------|-------------|-------------|------------|----------|-----------------|
| 1 | 50 | 1 | Hot | 50 | 50 | 0.5% | First day. 1 post per account, page 1 has tons of room |
| 2 | 100 | 2 | Hot | 50 | 100 | 0.9% | |
| **3** | 150 | 3 | **Hot + Warm** | **150** | 250 | 2.4% | Warm fires. Pages 2-3 have only old content -- our 3 posts are on page 1 |
| 4 | 200 | 4 | Hot | 50 | 300 | 2.8% | |
| 5 | 250 | 5 | Hot | 50 | 350 | 3.3% | Page 1 is half full with our posts |
| **6** | 300 | 6 | **Hot + Warm** | **150** | 500 | 4.7% | Warm fires. Still only fetching old content on pages 2-3 |
| **7** | 350 | 7 | **Hot + Cool + Stats** | **400** | 900 | 8.5% | First weekly deep run. Pages 4-9 are all old content |
| 8 | 400 | 8 | Hot | 50 | 950 | 9.0% | |
| **9** | 450 | 9 | **Hot + Warm** | **150** | 1,100 | 10.4% | |
| **10** | **500** | **10** | Hot | 50 | **1,150** | **10.8%** | **Page 1 EXACTLY full. Every post covered by hot tier alone.** |

**Phase 1 total: 1,150 credits (10.8% of budget)**

### Phase 2: Warm Tier Essential (Days 11-20) -- Posts Fall Off Page 1

Starting day 11, our oldest posts start falling off page 1 onto page 2. The warm tier (every 3 days) now catches these posts that the hot tier misses.

| Day | Total Posts | Posts/Acct | Tiers Fired | Day Credits | Cumulative | Budget % | What's Happening |
|-----|-----------|------------|-------------|-------------|------------|----------|-----------------|
| **11** | 550 | 11 | Hot | 50 | 1,200 | 11.3% | **Day 1's post falls off page 1 onto page 2.** Hot tier misses it now |
| **12** | 600 | 12 | **Hot + Warm** | **150** | 1,350 | 12.7% | **Warm catches day 1-2 posts on page 2.** First time warm fetches OUR posts |
| 13 | 650 | 13 | Hot | 50 | 1,400 | 13.2% | Day 1-3 posts are on page 2. Hot covers days 4-13 |
| **14** | 700 | 14 | **Hot + Cool + Stats** | **400** | 1,800 | 17.0% | Weekly deep run. Cool tier still fetching old content on pages 4-9 |
| **15** | 750 | 15 | **Hot + Warm** | **150** | 1,950 | 18.4% | Warm catches days 1-5 on page 2 |
| 16 | 800 | 16 | Hot | 50 | 2,000 | 18.9% | |
| 17 | 850 | 17 | Hot | 50 | 2,050 | 19.3% | |
| **18** | 900 | 18 | **Hot + Warm** | **150** | 2,200 | 20.8% | Warm catches days 1-8 on page 2 |
| 19 | 950 | 19 | Hot | 50 | 2,250 | 21.2% | |
| **20** | **1,000** | **20** | Hot | 50 | **2,300** | **21.7%** | **Page 2 exactly full with our posts (days 1-10)** |

**Phase 2 total: 1,150 credits (cumulative: 2,300 = 21.7%)**

### Phase 3: Approaching Steady State (Days 21-30) -- Posts Fill Page 3

Posts are now falling off page 2 onto page 3. Both warm pages (2-3) carry our posts.

| Day | Total Posts | Posts/Acct | Tiers Fired | Day Credits | Cumulative | Budget % | What's Happening |
|-----|-----------|------------|-------------|-------------|------------|----------|-----------------|
| **21** | 1,050 | 21 | **Hot+Warm+Cool+Stats** | **500** | 2,800 | 26.4% | **Biggest day of month 1.** Warm + weekly overlap. Day 1 falls off page 2 onto page 3 |
| 22 | 1,100 | 22 | Hot | 50 | 2,850 | 26.9% | |
| 23 | 1,150 | 23 | Hot | 50 | 2,900 | 27.4% | |
| **24** | 1,200 | 24 | **Hot + Warm** | **150** | 3,050 | 28.8% | Warm covers pages 2-3: days 1-4 on page 3, days 5-14 on page 2 |
| 25 | 1,250 | 25 | Hot | 50 | 3,100 | 29.2% | |
| 26 | 1,300 | 26 | Hot | 50 | 3,150 | 29.7% | |
| **27** | 1,350 | 27 | **Hot + Warm** | **150** | 3,300 | 31.1% | |
| **28** | 1,400 | 28 | **Hot + Cool + Stats** | **400** | 3,700 | 34.9% | Weekly deep run. Cool (pages 4-9) still mostly old content |
| 29 | 1,450 | 29 | Hot | 50 | 3,750 | 35.4% | |
| **30** | **1,500** | **30** | **Hot + Warm** | **150** | **3,900** | **36.8%** | **Month 1 complete. Page 3 exactly full. 1,500 posts across 50 accounts.** |

**Phase 3 total: 1,600 credits (cumulative: 3,900 = 36.8%)**

### Month 1 Final Summary

```
MONTH 1 TOTAL: 3,900 credits ($7.33)

Budget:     10,600 credits ($20.00)
Used:       36.8%
Remaining:  6,700 credits ($12.60)

Posts created:  1,500 (50 accounts x 30 days)
Posts tracked:  1,500 (100% coverage)
```

**Breakdown by tier:**

| Tier | Credits/Run | Runs | Total Credits | % of Month |
|------|-------------|------|---------------|------------|
| Hot (page 1) | 50 | 30 | 1,500 | 38.5% |
| Warm (pages 2-3) | 100 | 10 | 1,000 | 25.6% |
| Cool (pages 4-9) | 300 | 4 | 1,200 | 30.8% |
| Stats (/v1/profile) | 50 | 4 | 200 | 5.1% |
| Archive | 0 | 0 | 0 | 0% (no 30+ day posts yet) |
| **TOTAL** | | | **3,900** | **100%** |

**Day type pattern:**

| Day Type | Credits | Days | Subtotal |
|----------|---------|------|----------|
| Normal (Hot only) | 50 | 16 | 800 |
| Warm day (Hot + Warm) | 150 | 10 | 1,500 |
| Weekly day (Hot + Cool + Stats) | 400 | 3 | 1,200 |
| Overlap day (Hot + Warm + Cool + Stats) | 500 | 1 | 500 |
| **TOTAL** | | **30** | **4,000** |

> Note: Actual is 3,900 because warm fires on days 3,6,9,12,15,18,21,24,27,30 (10 times) and weekly fires on days 7,14,21,28 (4 times). Day 21 is the only overlap.

---

## 6. Month 2: Day-by-Day Credit Usage (Days 31-60)

**What changes in Month 2:** The **archive tier** activates. Posts from month 1 are now 30+ days old and need archive classification (monitor/cold/archived). Weekly deep runs now include pages 10-12.

**Active tiers:** Hot, Warm, Cool, Stats, **+ Archive (NEW)**

### Phase 4: Archive Kicks In (Days 31-40)

| Day | Total Posts | Posts/Acct | Tiers Fired | Day Credits | Month 2 Cumul. | Overall Cumul. | What's Happening |
|-----|-----------|------------|-------------|-------------|---------------|----------------|-----------------|
| **31** | 1,550 | 31 | Hot | 50 | 50 | 3,950 | **Day 1's post is now 31 days old.** Falls off page 3 onto page 4. Archive classification begins |
| 32 | 1,600 | 32 | Hot | 50 | 100 | 4,000 | |
| **33** | 1,650 | 33 | **Hot + Warm** | **150** | 250 | 4,150 | Warm catches days 21-30 on pages 2-3 |
| 34 | 1,700 | 34 | Hot | 50 | 300 | 4,200 | |
| **35** | 1,750 | 35 | **Hot+Cool+Stats+Archive** | **550** | 850 | 4,750 | **First weekly run WITH archive.** Pages 10-12 fetched for first time. System classifies day 1-5 posts as monitor or cold |
| **36** | 1,800 | 36 | **Hot + Warm** | **150** | 1,000 | 4,900 | |
| 37 | 1,850 | 37 | Hot | 50 | 1,050 | 4,950 | |
| 38 | 1,900 | 38 | Hot | 50 | 1,100 | 5,000 | |
| **39** | 1,950 | 39 | **Hot + Warm** | **150** | 1,250 | 5,150 | |
| 40 | 2,000 | 40 | Hot | 50 | 1,300 | 5,200 | 2,000 total posts. 40 per account across 4 pages |

**Phase 4 total: 1,300 credits**

### Phase 5: All Tiers Active (Days 41-50)

| Day | Total Posts | Posts/Acct | Tiers Fired | Day Credits | Month 2 Cumul. | Overall Cumul. | What's Happening |
|-----|-----------|------------|-------------|-------------|---------------|----------------|-----------------|
| 41 | 2,050 | 41 | Hot | 50 | 1,350 | 5,250 | |
| **42** | 2,100 | 42 | **Hot+Warm+Cool+Stats+Archive** | **650** | 2,000 | 5,900 | **BIGGEST day type. All 5 tiers fire.** Warm + weekly overlap. 650 credits |
| 43 | 2,150 | 43 | Hot | 50 | 2,050 | 5,950 | |
| 44 | 2,200 | 44 | Hot | 50 | 2,100 | 6,000 | |
| **45** | 2,250 | 45 | **Hot + Warm** | **150** | 2,250 | 6,150 | |
| 46 | 2,300 | 46 | Hot | 50 | 2,300 | 6,200 | |
| 47 | 2,350 | 47 | Hot | 50 | 2,350 | 6,250 | |
| **48** | 2,400 | 48 | **Hot + Warm** | **150** | 2,500 | 6,400 | |
| **49** | 2,450 | 49 | **Hot+Cool+Stats+Archive** | **550** | 3,050 | 6,950 | Weekly deep. Posts classified "cold" on day 35 get 2nd check. Still no growth? Move to monthly checks |
| 50 | 2,500 | 50 | Hot | 50 | 3,100 | 7,000 | 2,500 total posts. 50 per account across 5 pages |

**Phase 5 total: 1,800 credits**

### Phase 6: Stabilizing (Days 51-60)

| Day | Total Posts | Posts/Acct | Tiers Fired | Day Credits | Month 2 Cumul. | Overall Cumul. | What's Happening |
|-----|-----------|------------|-------------|-------------|---------------|----------------|-----------------|
| **51** | 2,550 | 51 | **Hot + Warm** | **150** | 3,250 | 7,150 | |
| 52 | 2,600 | 52 | Hot | 50 | 3,300 | 7,200 | |
| 53 | 2,650 | 53 | Hot | 50 | 3,350 | 7,250 | |
| **54** | 2,700 | 54 | **Hot + Warm** | **150** | 3,500 | 7,400 | |
| 55 | 2,750 | 55 | Hot | 50 | 3,550 | 7,450 | |
| **56** | 2,800 | 56 | **Hot+Cool+Stats+Archive** | **550** | 4,100 | 8,000 | Weekly deep. Pages 4-9 now full of OUR posts (days 1-20). Cool tier fully useful |
| **57** | 2,850 | 57 | **Hot + Warm** | **150** | 4,250 | 8,150 | |
| 58 | 2,900 | 58 | Hot | 50 | 4,300 | 8,200 | |
| 59 | 2,950 | 59 | Hot | 50 | 4,350 | 8,250 | |
| **60** | **3,000** | **60** | **Hot + Warm** | **150** | **4,500** | **8,400** | **Month 2 complete. 3,000 posts. 60 per account across 6 pages.** |

**Phase 6 total: 1,400 credits**

### Month 2 Final Summary

```
MONTH 2 TOTAL: 4,500 credits ($8.46)

Budget:     10,600 credits ($20.00)
Used:       42.5%
Remaining:  6,100 credits ($11.47)

Posts created this month:  1,500 (50 accounts x 30 days)
Total posts to date:       3,000
Posts tracked:             3,000 (100% coverage)
```

**Breakdown by tier:**

| Tier | Credits/Run | Runs | Total Credits | % of Month | vs Month 1 |
|------|-------------|------|---------------|------------|------------|
| Hot (page 1) | 50 | 30 | 1,500 | 33.3% | Same |
| Warm (pages 2-3) | 100 | 10 | 1,000 | 22.2% | Same |
| Cool (pages 4-9) | 300 | 4 | 1,200 | 26.7% | Same |
| Stats (/v1/profile) | 50 | 4 | 200 | 4.4% | Same |
| **Archive (pages 10-12)** | **150** | **4** | **600** | **13.3%** | **NEW (+600)** |
| **TOTAL** | | | **4,500** | **100%** | **+600 vs Month 1** |

**Day type pattern:**

| Day Type | Credits | Days | Subtotal |
|----------|---------|------|----------|
| Normal (Hot only) | 50 | 17 | 850 |
| Warm day (Hot + Warm) | 150 | 9 | 1,350 |
| Weekly day (Hot + Cool + Stats + Archive) | 550 | 3 | 1,650 |
| Overlap day (All 5 tiers) | 650 | 1 | 650 |
| **TOTAL** | | **30** | **4,500** |

---

## 7. Month 1 vs Month 2 Comparison

### Side-by-Side

| Metric | Month 1 | Month 2 | Change |
|--------|---------|---------|--------|
| Total credits | 3,900 | 4,500 | +600 (+15.4%) |
| Cost | $7.33 | $8.46 | +$1.13 |
| Budget used | 36.8% | 42.5% | +5.7% |
| Active tiers | 4 (Hot/Warm/Cool/Stats) | 5 (+Archive) | +1 tier |
| Normal day cost | 50 | 50 | Same |
| Warm day cost | 150 | 150 | Same |
| Weekly deep cost | 400 | 550 | +150 (archive) |
| Overlap day cost | 500 | 650 | +150 (archive) |
| Most expensive day | Day 21 (500 cr) | Day 42 (650 cr) | +150 |
| Posts tracked | 1,500 | 3,000 | +1,500 |
| Pages with our posts | 1-3 | 1-6 | +3 pages |

### Why Month 2 Costs Only 600 More

The ONLY addition is the archive tier running on 4 weekly deep days:

```
Month 1:  Hot + Warm + Cool + Stats                = 3,900
Month 2:  Hot + Warm + Cool + Stats + Archive       = 4,500
                                        ^
                               150 cr x 4 weeks = 600 credits

Everything else is identical.
```

### What Gets Cheaper Over Time

Starting month 2, posts classified as "cold" (below median views, no growth) move to monthly checks. This means the archive tier costs LESS than the theoretical 150 credits/week as more posts go cold:

```
Month 2:  150 credits/weekly archive run  (all posts fresh, need checking)
Month 3:  ~120 credits/weekly             (some posts now "cold", skipped)
Month 4:  ~100 credits/weekly             (more posts "cold")
Month 6:  ~80 credits/weekly              (most old posts archived/cold)
```

### Cumulative Cost After 2 Months

```
Month 1:    3,900 credits   ($7.33)
Month 2:    4,500 credits   ($8.46)
TOTAL:      8,400 credits   ($15.79)

If using one $47 pack (25,000 credits):
  Used:       8,400 / 25,000 = 33.6%
  Remaining:  16,600 credits
  Lasts for:  ~3.7 more months (total ~5.7 months per pack)
```

### Projected Monthly Costs Going Forward

| Month | Archive State | Est. Credits | Est. Cost |
|-------|--------------|-------------|-----------|
| 1 | No archive | 3,900 | $7.33 |
| 2 | Archive active, all posts fresh | 4,500 | $8.46 |
| 3 | Some posts "cold" (monthly checks) | ~4,400 | ~$8.27 |
| 4 | More posts "cold" | ~4,300 | ~$8.08 |
| 5 | First posts "archived" (never checked) | ~4,200 | ~$7.90 |
| 6+ | Steady state -- cold/archived growing | ~4,100-4,200 | ~$7.70-$7.90 |

**Long-term steady state: ~$8/month** as archive costs decrease from cold/archived classification.

---

## 8. Key Milestone Days (Days 31-90)

### Day 31 -- First Post Ages Past 30 Days

Day 1's post is now 31 days old. Falls off page 3 onto page 4. The cool tier (pages 4-9) now has OUR posts to track, not just pre-existing content. **Archive classification begins** -- posts are evaluated as "monitor" (top 20%) or "cold" (below median).

### Day 35 -- First Weekly Deep Run With Archive

First weekly run where archive-eligible posts exist. System fetches pages 10-12 for the first time with potential archive candidates.

**Credit usage this day:** 550 credits (Hot 50 + Cool 300 + Archive 150 + Stats 50)

### Day 42 -- Most Expensive Day Type

All 5 tiers fire (warm + weekly overlap). **650 credits in a single day.** This is the theoretical maximum daily cost.

Posts from days 1-12 are now 30+ days old (12 posts per account). Archive classification is meaningful: ~2-3 posts per account are "monitor" (top performers), rest move toward "cold".

### Day 49 -- Cold Posts Start Saving Credits

Posts classified as "cold" on day 35 have now had 2 weekly checks with no growth. If still no growth, they move from weekly to MONTHLY checks. Archive tier cost starts decreasing.

### Day 56 -- Cool Tier Fully Useful

Pages 4-9 are now full of OUR posts (days 1-20+). The cool tier is doing real work -- not just fetching pre-existing content.

### Day 60 -- Pages 1-6 All Ours

Each account has 60 of our posts across 6 pages:

```
Page 1:    days 51-60   (hot, daily)
Page 2:    days 41-50   (warm)
Page 3:    days 31-40   (warm)
Pages 4-6: days 1-30    (cool)
```

Monthly cost stabilizing around 4,500 credits.

### Day 70 -- Early Archival Candidates

Posts classified "cold" on day 35 and showing zero growth across 5 weekly checks. Not yet permanently archived (need 3 months cold), but already saving credits by being on monthly checks.

### Day 84 -- Efficient Weekly Deep Runs

Full weekly run cost is theoretically 650 credits, but cold posts are being skipped. Actual archive cost: ~80-100 credits instead of 150. **Effective weekly deep cost: ~530-550 credits.**

### Day 90 -- System at Full Design Scale

Each account has 90 posts across 9 pages. This is the design target of the plan.

```
Page 1:    days 81-90    (hot, daily)
Pages 2-3: days 61-80    (warm, every 3 days)
Pages 4-9: days 1-60     (cool, weekly)
Page 10+:  archive zone   (starts filling day 91)
```

ALL tiers operating as designed. Monthly steady-state: **~4,200-4,500 credits/month ($7.90-$8.46)**.

### Cumulative Credit Usage at Key Days

| Day | Posts/Acct | Total Posts | Typical Day Cost | Est. Overall Cumulative |
|-----|-----------|-------------|-----------------|------------------------|
| 10 | 10 | 500 | 50 | 1,150 |
| 20 | 20 | 1,000 | 50 | 2,300 |
| **30** | **30** | **1,500** | 150 | **3,900 (end month 1)** |
| 35 | 35 | 1,750 | 550 | ~4,750 |
| 42 | 42 | 2,100 | 650 | ~5,900 |
| 49 | 49 | 2,450 | 550 | ~6,950 |
| **60** | **60** | **3,000** | 150 | **8,400 (end month 2)** |
| 70 | 70 | 3,500 | 50 | ~9,800 |
| 84 | 84 | 4,200 | 530 | ~11,700 |
| **90** | **90** | **4,500** | 50 | **~12,600 (end month 3)** |

---

## 9. Monthly Credit Budget at Scale

### Steady-State Monthly Cost (50 Accounts)

| Operation | Frequency | Credits/Run | Runs/Month | Credits/Month | Priority |
|-----------|-----------|-------------|------------|---------------|----------|
| Hot (page 1) | Daily | 50 | 30 | 1,500 | NEVER cut |
| Warm (pages 2-3) | Every 3 days | 100 | 10 | 1,000 | Cut 3rd |
| Cool (pages 4-9) | Weekly | 300 | 4 | 1,200 | Cut 2nd |
| Archive (pages 10-12) | Weekly | 150 | 4 | 600 | Cut 1st |
| Account stats | Weekly | 50 | 4 | 200 | Cut 4th |
| Buffer | -- | -- | -- | 500 | Experiments |
| **TOTAL** | | | | **5,000** | **$9.40/mo** |

> Note: Actual cost is ~4,500/month because archive costs decrease as posts go cold/archived. The 5,000 figure includes a 500 credit buffer for experiments and ad-hoc checks.

### Cost Math

```
Monthly credits:   5,000 (theoretical max)
Actual monthly:    ~4,500 (with cold/archived savings)
Cost per 1K:       $1.88 (Freelance plan)
Monthly cost:      $8.46-$9.40
Budget:            $20.00
Headroom:          $10.60-$11.54 (53-58% buffer)

One $47 pack (25K credits) lasts: ~5.5 months
```

### Scaling Table

| Accounts | Posts/Month | Credits/Month | Cost/Month | Under $20? |
|----------|-----------|---------------|------------|------------|
| 4 (current) | 360 | ~500 | $0.94 | Yes |
| 10 | 900 | ~1,200 | $2.26 | Yes |
| 25 | 2,250 | ~2,800 | $5.26 | Yes |
| **50 (target)** | **4,500** | **~5,000** | **$9.40** | **Yes** |
| 75 | 6,750 | ~7,500 | $14.10 | Yes |
| 100 | 9,000 | ~10,000 | $18.80 | Barely |
| **106 (max)** | **9,540** | **~10,600** | **$19.93** | **Limit** |

---

## 10. Credit Safety Rails

### Throttle Levels Based on Monthly Budget Consumption

```
MONTHLY_BUDGET = 10,600 credits ($20 worth)

  < 80% used   ->  Normal operation (all tiers)
  80-90% used  ->  Skip archive monitors (saves 600/mo)
  90-95% used  ->  Skip cool tier too, keep hot + warm only
  > 95% used   ->  HOT TIER ONLY (page 1 daily) -- bare minimum survival
```

### Priority Ladder (What to Cut First)

1. Archive monitors -> saves 600/month
2. Cool tier frequency (weekly -> biweekly) -> saves 600/month
3. Warm tier frequency (every 3 days -> weekly) -> saves 700/month
4. Account stats (weekly -> monthly) -> saves 150/month
5. **NEVER CUT: Hot tier (page 1 daily)** -- this is the core data

### Credit Source

- API returns `credits_remaining` in every response -- use as ground truth
- Also maintain internal counter as backup for monthly tracking
- If `credits_remaining` < 100 mid-run: abort gracefully, save partial results

### Worst-Case Scenario

If TikTok changes page size to 8, or posting frequency rises to 5/day:

```
Pages for 30 days: 30 x 5 / 8 = 19 pages per account (vs 9 now)
Weekly deep: 50 x 19 = 950 calls = 950 credits
Monthly: ~8,700 credits = $16.36 -- still under $20
```

---

## 11. Run Duration Fix

### Current Problem

Self-imposed 120/hr rate limit in `api-client.ts:19`. ScrapeCreators has NO rate limits on their side. Weekly deep run on 50 accounts takes 4.2 hours -- unacceptable.

### Solution: Raise Limit + Add Concurrency

| Approach | Daily Run | Every-3-Day Run | Weekly Deep |
|----------|-----------|----------------|-------------|
| Current (120/hr, sequential) | 25 min | 80 min | **4.2 hours** |
| 600/hr, sequential | 5 min | 15 min | 55 min |
| **600/hr, 5x concurrent** | **3 min** | **6 min** | **15 min** |
| 600/hr, 10x concurrent | 2 min | 4 min | 8 min |

**Recommended:** 600/hr rate limit + 5 concurrent requests.

### Implementation

```typescript
// api-client.ts -- change from:
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

## 12. Required Code Changes

### Change 1: Remove Fetch-Once Filter

**File:** `pull_analytics.ts:274`

```
REMOVE:  (r.views === '-' || r.views === '0')
REPLACE: tier-based eligibility check using post age + last_fetched date
```

### Change 2: Add Tracker Columns

**File:** `pull_analytics.ts` -- TrackerRow interface + serializer

New columns:
- `Last Fetched`: ISO date of last metric update
- `Fetch Count`: number of times metrics have been pulled
- `Tier`: hot / warm / cool / monitor / cold / archived

### Change 3: aweme_id Matching for Bulk Updates

**File:** `pull_analytics.ts` -- new function `updateMetricsFromBulk()`

```
For each account:
  1. Call /v3/profile/videos (paginate as tier requires)
  2. Build map: aweme_id -> statistics
  3. For each tracker row with a TikTok URL:
     - Extract aweme_id from URL
     - Look up in map
     - Update metrics if found
  4. For unresolved rows (no URL):
     - Use hashtag matching + date proximity (+/-3 days)
     - Once matched, store aweme_id for future direct matching
```

### Change 4: Credit Tracking

**New file:** `data/CREDIT-USAGE.md`

Track per-run: date, operation, credits used, credits remaining (from API response). Monthly rollup with budget % consumed.

### Change 5: Stale Draft Cleanup

**File:** `pull_analytics.ts` -- `checkBlotPostStatus()`

- If post is `in-progress` and date > 7 days ago -> mark `stale`, skip future Blotato checks
- If stale post appears in `/v3/profile/videos` -> resurrect as `published`

### Change 6: Raise Rate Limit + Add Concurrency

**File:** `api-client.ts:19`

```typescript
scrapeCreators: { requests: [], maxPerHour: 600 }
```

Add `batchRequests()` utility for 5x parallel API calls.

### Change 7: Concurrency Guard for Tracker Writes

**File:** `pull_analytics.ts`

- Atomic writes: `writeFile(path + '.tmp')` then `rename` to path
- PID-based lock file to prevent overlapping analytics runs
- If lock exists and PID alive -> exit immediately
- If lock exists but PID dead (crash) -> remove stale lock, proceed

---

## 13. Optimizer Bug Fixes

The analytics data is only useful if the optimizer works correctly. Three bugs must be fixed.

### Bug 1: Winner/Loser Both Marked "keep"

**File:** `optimizer.ts:~201`

```typescript
// Current (BUG):
result.winner === 'A' ? 'keep' : 'keep'

// Fix:
result.winner === 'A' ? 'keep' : 'discard'
```

### Bug 2: Variant Matching Grabs Wrong Post

**File:** `optimizer.ts`

```
Current: takes FIRST post matching hookStyle
Fix:     filter to posts within experiment date range, same account, same flow type
```

### Bug 3: Format Winners Sorted by Views, Not Save Rate

**File:** `optimizer.ts` -- `refreshFormatWinners()`

```
Current: sorts by avg views
Fix:     sort by avg save rate (consistent with experiment criterion)
```

### Experiment Evaluation Timing

With tiered fetching, ensure both experiment variants have been fetched at the SAME tier level before comparing. Don't compare a post with day-2 metrics against one with day-7 metrics.

```
Rule: both variants must have fetch_count >= 2
      AND last_fetched within 24h of each other
```

---

## 14. The refresh:smart Command Flow

```bash
npm run refresh:smart    # replaces npm run refresh for analytics
```

### Flow

```
refresh:smart
|
|-- 1. Acquire PID lock
|     |-- If locked by live process: exit immediately
|     |-- If lock exists but PID dead: remove stale lock, proceed
|
|-- 2. Read POST-TRACKER.md + CREDIT-USAGE.md
|     |-- Calculate budget consumed this month
|     |-- Determine throttle level (normal / skip-archive / hot-only)
|
|-- 3. Blotato status sync (no ScrapeCreators credits used)
|     |-- Check posts without TikTok URLs (skip stale >7d)
|     |-- Mark newly published, newly stale
|
|-- 4. For each of 50 accounts (5 concurrent):
|     |-- ALWAYS: /v3/profile/videos page 1 (hot tier)
|     |     |-- Match by aweme_id for existing posts
|     |     |-- Resolve URLs for new posts (hashtag + date proximity)
|     |     |-- Update metrics for all matched posts
|     |-- IF every-3-day cycle: pages 2-3 (warm tier)
|     |-- IF weekly cycle: pages 4-9 (cool tier) + account stats
|     |-- IF weekly + budget allows: pages 10-12 (archive monitors)
|
|-- 5. Atomic write POST-TRACKER.md
|     |-- Update last_fetched, fetch_count, tier for each row
|
|-- 6. Update CREDIT-USAGE.md
|     |-- Log: date, credits used, credits remaining, budget %
|
|-- 7. Budget guard warnings
|     |-- >80% consumed: log warning
|     |-- >95%: set emergency mode flag for next run
|
|-- 8. Release lock
```

### Schedule

```bash
/loop 24h npm run refresh:smart

# The script internally decides what to fetch based on:
#   - Day of month (weekly = every 7th run)
#   - Last deep fetch timestamp (stored in CREDIT-USAGE.md)
#   - Current budget consumption level
```

---

## 15. Edge Cases & Mitigations

### Post Deleted from TikTok

`/v3/profile/videos` won't return it anymore. Tracker keeps last-known metrics (never zero them out). After 3 consecutive fetches where post is absent from profile, mark as `deleted`.

### Account Banned/Suspended

API returns error or empty `aweme_list`. Log warning, skip account for this run. If empty for 7+ consecutive days, flag account as `suspended` in tracker.

### ScrapeCreators Goes Down

API returns 500/timeout. Retry with backoff (already implemented in api-client.ts). If all retries fail, run completes with partial data. Never crash the whole refresh because one account failed.

### Page Size Changes

TikTok might return 8 or 15 per page instead of 10. System must use `has_more` flag to decide pagination, not hardcoded page count. Budget guard adapts automatically (more pages = more credits = throttle sooner).

### Posting Frequency Varies Across Accounts

Some accounts post 1/day, others 5/day. Page 1 covers different date ranges per account -- that's fine. Tier schedule is based on post AGE, not page number. System tracks `oldest_date_on_page` to know coverage depth.

### Two Runs Overlap

PID-based lock file prevents concurrent analytics runs. If lock exists and PID alive -> exit immediately. If lock exists but PID dead (crash) -> remove stale lock, proceed.

### Credits Run Out Mid-Run

Check `credits_remaining` from each API response. If < 100 remaining, abort gracefully (save partial results via atomic write). Never leave tracker in corrupted state.

### New Account Added (Account 51)

No posts in profile yet -> empty `aweme_list` -> skip, zero credits wasted. System auto-adapts as posts appear.

---

## 16. Implementation Order

The order is deliberate -- each step unblocks the next:

| # | Step | Why This Order |
|---|------|---------------|
| **1** | **Fix optimizer bugs** | Without this, better data feeds a broken optimizer |
| 2 | Add credit tracking | Need visibility before scaling |
| 3 | Raise rate limit to 600/hr | Unblocks everything else |
| 4 | Add aweme_id matching | Required before scaling to 50 accounts |
| 5 | Add tracker columns | last_fetched, fetch_count, tier infrastructure |
| **6** | **Build tiered fetch logic** | The core of the entire plan |
| 7 | Add concurrency + atomic writes | For 50-account scale |
| 8 | Add stale draft cleanup | Prevents unbounded Blotato polling |
| 9 | Wire up as `npm run refresh:smart` | New entry point |
| **10** | **Test with 4 accounts first** | Validate credit math before scaling to 50 |

### What This Plan Does NOT Cover

- **Blotato API costs** -- separate, generous rate limits, not a concern
- **Virlo API credits** -- trend research is a separate budget
- **Gemini API costs** -- image generation costs
- **TikTok direct API access** -- would be free but different rate limits
- **Statistical significance** -- low traffic = low confidence A/B tests; this plan improves data freshness but doesn't solve the sample size problem

---

*Generated: April 2026 | MinuteWise TikTok Content Engine*
