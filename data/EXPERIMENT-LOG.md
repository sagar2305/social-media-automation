# Experiment Log

_A/B test history. Each experiment runs within a single account — never cross-account._

**Format:** Every experiment MUST include an `Account` field. Both variants are posted to that same account.

---

## Active Experiments

_None — next experiment starts with next cycle._

---

## Completed Experiments

### Experiment #REFRESH-001 — 2026-04-14 (Fresh Data Analysis)
- **Account:** @yournotetaker
- **Variable:** hook_style (contrast vs others, refreshed metrics)
- **Method:** Pulled latest 10 posts via ScrapeCreators v3
- **Finding:** contrast 6-slide dominates — avg 184.5 views (224, 216, 171, 127). All other hooks under 110 views.
- **Breakdown:**
  - contrast 6-slide: 224, 216, 171, 127 → avg 184.5 views, 1 save (0.45% on best post)
  - bold_claim 8-9 slide: 85-109 → avg 97 views, best save rate 1.08%
  - stat_lead 8-9 slide: 100-130 → avg 109 views
  - story_opener any: 4-18 views → essentially dead
  - question 6-slide: 127 views (decent, 1 data point)
- **Verdict:** WINNER — contrast 6-slide confirmed as top format for @yournotetaker. Question hook shows promise at 127 views — needs more testing.

### Experiment #REFRESH-002 — 2026-04-14 (Fresh Data Analysis)
- **Account:** @miniutewise_thomas
- **Variable:** baseline performance analysis
- **Method:** Pulled latest 10 posts via ScrapeCreators v3
- **Finding:** Thomas has a high baseline — avg 350 views across all 10 posts regardless of content.
- **Breakdown:**
  - Top post: 438 views, 8 likes, 1 save (0.23%)
  - Best save rate: 1.83% (383 views, 7 saves)
  - contrast 6-slide (our posts): 371 views/3 saves, 327 views/0 saves → avg 349 views
  - Other posts (not ours): avg 362 views — similar performance
- **Verdict:** Thomas's audience gives consistent 300-400 views baseline. Our contrast 6-slide posts perform at baseline — not outperforming yet. Need to test different hooks on Thomas specifically.

### Experiment #479300 — 2026-04-08
- **Account:** @yournotetaker
- **Variable:** hook_style
- **Variant A:** contrast — Post cmnd2ccbr03rsvv0ykny6s7p4 — 0 views, 0% save rate
- **Variant B:** bold_claim — Post cmnbutgwo01z5qw0yo7sxt2lw — 0 views, 0% save rate
- **Verdict:** INCONCLUSIVE — both variants stuck in old Postiz drafts, never published

### Experiment #HIST-001 — 2026-04-07 (Historical Analysis)
- **Account:** @yournotetaker
- **Variable:** hook_style
- **Method:** Scanned 50 most recent @yournotetaker posts via ScrapeCreators v3
- **Finding:** 12 posts >80 views, all animated flow
- **Winner:** contrast/imperative hooks ("Stop X") on 6-slide = highest views (202, 156)
- **Runner-up:** bold_claim hooks on 8-slide = best save rate (1.04%)
- **Loser:** story_opener hooks = 0 posts >80 views (max 7 views)
- **Verdict:** WINNER — contrast > stat_lead > bold_claim >> story_opener for @yournotetaker

### Experiment #HIST-002 — 2026-04-07 (Historical Analysis)
- **Account:** @yournotetaker
- **Variable:** slide_count
- **Variant A:** 6-slide — 179 avg views, 0% save rate
- **Variant B:** 8-slide — 97 avg views, 1.04% save rate
- **Verdict:** WINNER — 6-slide gets 2x views, 8-slide gets best save rate. Variant A wins on views.

### Experiment #HIST-003 — 2026-04-07 (Historical Analysis)
- **Account:** @yournotetaker
- **Variable:** hook_style
- **Variant A:** bold_claim — 97 views, 0.41% save rate
- **Variant B:** stat_lead — 109 views, 0.19% save rate
- **Verdict:** WINNER — bold_claim better saves (2 vs 1), stat_lead slightly more views. Variant A wins on save rate.

### Experiment #704431 — 2026-04-07
- **Account:** @yournotetaker
- **Variable:** hook_style
- **Variant A:** question — Post cmnd4eihw043lph0yxd3krlm9 — 0 views, 0% save rate
- **Variant B:** stat_lead — Post cmnc0fjc600bkvv0ylocwtroi — 0 views, 0% save rate
- **Verdict:** INCONCLUSIVE — both variants stuck in drafts, never published

### Experiment #006 — 2026-04-02 (CROSS-ACCOUNT — INVALID)
- **Account:** @yournotetaker, @grow.withamanda, @hack.my.study
- **Variable:** hook_style
- **Variant A:** story_opener — Post cmngv4s7202juql0yo6hbq3zx (@yournotetaker)
- **Variant B:** stat_lead — Post cmngv4sla02brpn0ywq7qjx0b (@grow.withamanda)
- **Variant C:** bold_claim — Post cmngv4sxv02bspn0yas3gi6py (@hack.my.study)
- **Verdict:** INVALID — cross-account comparison. Animated 9-slide across 3 different accounts. Results cannot be compared.

### Experiment #005 — 2026-04-02 (CROSS-ACCOUNT — INVALID)
- **Account:** @yournotetaker, @grow.withamanda, @hack.my.study
- **Variable:** hook_style
- **Variant A:** question — emoji_overlay 8-slide, posted across all 3 accounts
- **Variant B:** stat_lead — emoji_overlay 8-slide, posted across all 3 accounts
- **Verdict:** INVALID — cross-account comparison. All variants still in drafts, awaiting publish. Even if published, cross-account results are not comparable.

### Experiment #002 — 2026-03-30
- **Account:** @yournotetaker
- **Variable:** hook_style
- **Variant A:** contrast, 2-slide — Post cmnd2ccbr (published, @yournotetaker)
- **Variant B:** story_opener, 4-slide — Post cmnd4epk7 (published, @yournotetaker)
- **Verdict:** INCONCLUSIVE — both show 0 tracked engagement at post level.

### Experiment #001 — 2026-03-30
- **Account:** @yournotetaker
- **Variable:** hook_style
- **Variant A:** story_opener, 1-slide — Post cmnd2brco (published, @yournotetaker)
- **Variant B:** stat_lead, 1-slide — Post cmnd2c793 (published, @yournotetaker)
- **Verdict:** INCONCLUSIVE — both posts show 0 tracked engagement. 1-slide format insufficient.

### Experiment #003 — 2026-03-29
- **Account:** @yournotetaker
- **Variable:** hook_style
- **Variant A:** bold_claim, 7-slide — Post cmnbutgwo (draft, @yournotetaker)
- **Variant B:** stat_lead, 5-slide — Posts cmnc0fjc6, cmnc0ft2i (both drafts, @yournotetaker)
- **Verdict:** NOT TESTED — all posts remained as drafts, never published.

---

## Key Learnings (Cumulative)

1. **contrast 6-slide is the winning format for @yournotetaker** — avg 184.5 views, confirmed across 4 posts (127-224 range). REFRESH-001 validates HIST-001.
2. **question hook shows promise** — 127 views on first test, needs more data points on @yournotetaker
3. **story_opener is dead** — max 18 views across all tests. Do not use.
4. **@miniutewise_thomas has 350 views baseline** — his audience engages regardless of hook. Our posts perform at baseline, not above. Need Thomas-specific experiments.
5. **Thomas's best save rate: 1.83%** — higher than any @yournotetaker post. Thomas audience saves more.
6. **Slide count matters** — 6-slide > 8-slide for views (2x), 8-slide > 6-slide for save rate
7. **Animated > Photorealistic** — animation catches attention; photorealistic blends in
8. **Drafts don't generate data** — many experiments wasted because posts stayed as drafts
9. **Cross-account comparisons are INVALID** — different audience sizes make results unreliable
10. **Each account needs its own experiment track** — validated: what works on @yournotetaker doesn't translate to @miniutewise_thomas
