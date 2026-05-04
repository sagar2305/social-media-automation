# autoresearch — Autonomous Content Experimentation

_Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch). Adapted for TikTok content optimization._

This is an experiment to have the LLM optimize content strategy autonomously.

---

## Setup

To set up a new experiment session:

1. **Read all context files:**
   - `CLAUDE.md` — project rules, API docs, accounts
   - `RULES.md` — content pipeline rules
   - `data/FORMAT-WINNERS.md` — what's winning
   - `data/LESSONS-LEARNED.md` — what to avoid
   - `data/EXPERIMENT-LOG.md` — active/completed experiments
   - `data/POST-TRACKER.md` — all posts with metrics
   - `data/ACCOUNT-STATS.md` — account-level performance
   - `data/HASHTAG-BANK.md` — hashtag tiers
   - `data/results.tsv` — full experiment history
2. **Check API keys:** Ensure `.env.local` has `BLOTATO_API_KEY`, `GEMINI_API_KEY`, and `SCRAPECREATORS_API_KEY`.
3. **Confirm and go:** Start the experimentation loop.

---

## The Experiment Loop

**LOOP EVERY 24 HOURS:**

### Phase 1: MEASURE (fetch real per-post metrics)

**Step 1a — Blotato status sync:**
For every post in POST-TRACKER.md missing a TikTok URL:
1. Call Blotato: `GET /posts/{postSubmissionId}`
2. Read `publicUrl` field (NOT `result.url`) for the TikTok URL
3. Update status: `published`, `in-progress`, or `failed`

**Step 1b — Resolve missing URLs via ScrapeCreators v3:**
When Blotato doesn't return a specific post URL (only profile URL or nothing):
1. Call ScrapeCreators: `GET /v3/tiktok/profile/videos?handle={handle}` for each account
   - **IMPORTANT:** v1 endpoint is SUSPENDED. Must use `/v3/`.
2. Match tracker rows to TikTok videos by hashtag overlap (>=2 matches)
3. Only match within the correct account — never cross-account
4. Never assign the same TikTok video ID to multiple tracker rows

**Step 1c — Per-post metrics:**
For every published post with a specific TikTok URL (must contain `/video/` or `/photo/`):
1. Call ScrapeCreators: `GET /v2/tiktok/video?url={tiktok_url}&trim=true`
2. Extract: `play_count` (views), `digg_count` (likes), `collect_count` (saves), `share_count` (shares), `comment_count` (comments)
3. Calculate save rate: `collect_count / play_count * 100`
4. Update POST-TRACKER.md with real numbers

**Step 1d — Account stats:**
5. Update ACCOUNT-STATS.md via ScrapeCreators: `GET /v1/tiktok/profile?handle={handle}`

### Phase 2: EVALUATE (check experiments older than 24h)

For each active experiment in EXPERIMENT-LOG.md:

1. Check if both variants have 24+ hours of data
2. **Verify both variants belong to the SAME account** — if not, mark as INVALID
3. Compare **save rate** as primary metric (views as secondary)
4. Decision:
   - Save rate difference > 20% relative → **WINNER declared**
   - Save rate difference < 20% → **INCONCLUSIVE**
   - Both variants have 0 saves but different views → use **views** as tiebreaker
5. If winner:
   - Update FORMAT-WINNERS.md — promote winning format **for that specific account**
   - Update LESSONS-LEARNED.md — add insight (note which account)
   - Log to results.tsv: `keep`
6. If loser:
   - Log to results.tsv: `discard`
   - Deprioritize that variable **for that account** in future experiments
7. If inconclusive:
   - Log to results.tsv: `inconclusive`
   - Move on to test a different variable

### Phase 3: HYPOTHESIZE (design next experiment)

**Only change ONE variable per experiment.** Keep everything else the same.

Read FORMAT-WINNERS.md and results.tsv to understand what's been tested.

#### Per-Account Experiment Tracks

**Each account runs its own independent experiment track.** Experiments are NEVER compared across accounts because audience size, algorithm trust, and follower engagement vary drastically between accounts.

| Account | Handle | Notes |
|---------|--------|-------|
| yournotetaker | @yournotetaker | Baseline account, most experiments here |
| Amanda | @grow.withamanda | Separate experiment track |
| Thomas | @miniutewise_thomas | Established account, high views regardless — experiments here test within its own baseline |
| Claudia | @grow.with.claudia | Separate experiment track |

**Every experiment MUST specify which account it belongs to.** Both Variant A and Variant B are posted to that SAME account. Results only apply to that account's learnings.

A finding on `@yournotetaker` does NOT automatically apply to `@miniutewise_thomas`. If you want to validate a winner across accounts, run the same experiment separately on each account.

**Variable priority queue** (test in this order per account, skip already-tested ones for that account):

| Priority | Variable | Options to Test |
|----------|----------|-----------------|
| 1 | Hook style | question, bold_claim, story_opener, stat_lead, contrast |
| 2 | Slide count | 5, 6, 8, 9 |
| 3 | Flow type | photorealistic, animated, emoji_overlay |
| 4 | Animation style | Pixar 3D, Anime, Stop Motion, Watercolor, Pop Art, etc. |
| 5 | Posting time | Morning (8am), Afternoon (2pm), Evening (8pm), Night (12am) |
| 6 | Hashtag strategy | Tier 1 heavy vs Tier 3 heavy |
| 7 | CTA style | "Save for later" vs "Tag a friend" vs "Follow for more" |
| 8 | Caption length | Short (1 line) vs Long (3 lines + hashtags) |

**Rules for hypothesis:**
- Pick the LEAST TESTED variable **for the target account** from the priority queue
- Variant A = current best (control) from FORMAT-WINNERS.md **for that account**
- Variant B = the experimental change
- **CRITICAL: Both variants MUST go to the SAME account — NO EXCEPTIONS.** Cross-account comparisons are INVALID.
- Each cycle, pick ONE account to run an experiment on. Rotate accounts across cycles so all accounts get tested over time.

### Phase 4: GENERATE + POST

1. Pick the target account for this cycle's experiment
2. Generate Variant A and Variant B content for that account
3. Use `npm run flow1`, `npm run flow2`, or `npm run flow3` depending on the experiment
4. Or call the pipeline scripts directly if custom parameters needed
5. Post both variants as TikTok drafts via Blotato (`isDraft: true`) to the **same account**
6. Record in EXPERIMENT-LOG.md:
   - Experiment ID, date, **account handle**, hypothesis
   - Variant A and Variant B descriptions
   - Post IDs for each variant
   - Status: IN PROGRESS
7. Record in POST-TRACKER.md with all post details
8. Log initial entry to results.tsv (include account column)

### Phase 5: UPDATE DASHBOARDS

1. Update FORMAT-WINNERS.md with latest rankings
2. Update LESSONS-LEARNED.md rolling dashboard
3. Update TRENDING-NOW.md if Virlo has credits
4. Update HASHTAG-BANK.md with any new performance data

---

## Logging Results

Log every experiment to `data/results.tsv` (tab-separated).

**Header:**
```
experiment_id	date	account	variable	variant_a	variant_b	metric_a	metric_b	views_a	views_b	saves_a	saves_b	status	description
```

**Status values:** `keep`, `discard`, `inconclusive`, `crash`, `in_progress`

**Example:**
```
exp_001	2026-04-04	yournotetaker	hook_style	story_opener	stat_lead	0.0%	0.0%	0	0	0	0	inconclusive	1-slide photorealistic, both zero engagement
exp_002	2026-04-04	yournotetaker	format	animated_8	photo_4	-	-	11388	427	-	-	keep	animated 8-slide correlated with 10x views
exp_003	2026-04-05	grow.withamanda	hook_style	story_opener	question	-	-	-	-	-	-	in_progress	emoji_overlay 8-slide experiment
```

---

## Critical Rules

1. **ONE variable per experiment.** Never change two things at once.
2. **24 hours minimum** before evaluating an experiment.
3. **Save rate is the primary metric.** Views are secondary. Saves = algorithm signal = viral potential.
4. **SAME account for BOTH variants — NO exceptions.** Each account is its own experiment track. Never compare posts across different accounts. Audience size, algorithm trust, and follower engagement differ too much.
5. **Every experiment MUST have an `account` field.** Always log which account the experiment belongs to — in EXPERIMENT-LOG.md, results.tsv, and the Supabase `experiments` table.
6. **Results are account-specific.** A winner on `@yournotetaker` is not automatically a winner on `@grow.withamanda`. To validate cross-account, run the same experiment separately on each.
7. **Rotate accounts across cycles.** Don't only test on one account — spread experiments so all accounts learn and improve.
8. **Log EVERYTHING** to results.tsv — even crashes and failures. Include the account column.
9. **Read past results for the target account** before designing new experiments — don't repeat failed ideas for that account.
10. **Keep FORMAT-WINNERS.md current** — the pipeline reads this for content generation.

---

## NEVER STOP

Once the experiment loop has begun, do NOT pause to ask the human.
Do NOT ask "should I keep going?" or "is this a good stopping point?".
The human might be asleep, or away from the computer.
You are **autonomous**. Continue indefinitely until manually stopped.

If you run out of ideas:
- Re-read LESSONS-LEARNED.md for angles you haven't tested
- Combine two previously successful variables
- Try more radical changes (completely different animation style, controversial hooks)
- Look at TRENDING-NOW.md for new content angles
- Test timing variables (morning vs night posting)

The loop runs until the human interrupts you, period.

---

## Running

```bash
/loop 24h "Read program.md and run one experiment cycle"
```

Or manually:
```bash
npm run autoresearch
```
