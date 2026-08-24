---
name: creddy-agent-01-calibration
description: Calibrate Creddy Agent 01 points-and-miles discovery using disposable Agent 01+02 runs and explicit retained/rejected feedback. Use when reviewing discovery quality, tuning sources or searches, recording editorial preferences, or evaluating promising new sources. Do not use for slideshow styling, Slack review, scheduling, activation, or publishing.
---

# Creddy Agent 01 calibration

Improve discovery quality without activating or delivering the pipeline.

## Invariants

- Keep `CREDDY_PIPELINE_ENABLED=false`.
- Run only Agents 01 and 02 during calibration. Do not invoke Slack, rendering, scheduling, or publishing.
- Treat local JSON and reports as the audit record.
- Never print environment values.
- Keep at least 80% of the scrape allowance for core points-and-miles topics and no more than 20% for adjacent exploration.
- Treat community and creator content as signals. Material claims still require authoritative confirmation later.
- Never add, remove, enable, or crawl a proposed source automatically.
- Do not use Supabase, embeddings, another database, or a new service for this workflow.

## Run a calibration batch

1. Confirm the branch is based on current `origin/main` and the worktree has no unexpected changes.
2. Run `npm run creddy:validate` and `npm run creddy:test`.
3. Create a new disposable directory whose name starts with `agent01-calibration-`.
4. Run `npm run creddy:pipeline -- agent-1-calibrate` with that directory as `CREDDY_DATA_ROOT` and `CREDDY_AGENT01_CALIBRATION=true`. Do not change the pipeline-enabled flag.
5. Open `reports/latest/01-discovery-and-collection.md` and `reports/latest/02-filtering-and-deduplication.md`.
6. Present the latest retained and rejected lists with title, source, URL, reason, and record ID. Also show deferred low-relevance items and emerging domains.

The 24-hour freshness rule is exact when a feed or search result supplies `publishedAt`. Listing-page candidates without publication metadata remain marked as unknown freshness until their article metadata is collected; do not describe them as confirmed fresh.

## Record user feedback

When the user corrects a decision, append it with:

`npm run creddy:pipeline -- agent-1-feedback <retain|reject> <canonical-url> <source-id> <source-name> <run-id> <reason> [note]`

Use the durable configured data root for feedback, not the disposable calibration root. Repeating identical feedback is an idempotent no-op. Never rewrite or delete older feedback.

After recording feedback, review `reports/latest/01-editorial-feedback.md`. Distinguish an exact correction, a recurring preference that may justify a bounded rule change, and a source proposal that remains inactive until explicitly approved.

Do not generalize from one ambiguous example. Prefer the smallest rule supported by repeated feedback or an explicit editorial instruction. Preserve the fixed scrape cap, 80/20 boundary, lane fairness, and factual-use tiers.

## Promising sources

Call an external domain or creator identity “promising,” not “popular,” unless real engagement metrics exist. Recommend it only after at least three retained items across at least two runs. Include sample URLs, retained/rejected counts, corroboration, and why it adds coverage missing from current sources. Keep creators on multi-tenant platforms such as YouTube separate by source/channel identity; never treat the whole platform as one source.

## Completion report

Report the run ID, source/search health, selected/core/adjacent/deferred counts, retained and rejected lists, Firecrawl request accounting, feedback effects, promising-source proposals, report paths, and blockers. State explicitly that activation, scheduling, Slack, and publishing were not touched.
