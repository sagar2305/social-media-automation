# Creddy automation implementation status

**Date:** 1 September 2026
**Code status:** rolling hourly orchestration implemented; activation remains gated
**Production status:** existing local services remain active; the new hourly schedule is not created by this change

## Implemented flow

1. Agent 01 collects 18 enabled sources and six of 12 rotating focused topic searches per editorial window. Reddit and creator feeds bypass Firecrawl when a direct feed is available.
2. Immutable raw files are partitioned by date/run in the dedicated data project.
3. OR-keyword filtering, context checks, article-body cleaning, exact and conservative
   near-title duplicate detection, and supporting-evidence grouping produce canonical news records.
4. Hourly Codex analysis uses the `creddy-ranking-v3` viral rubric, channel-fit
   predictions, freshness, product fit, importance, and confidence to calculate
   editorial priority. Editorial upside stays independent of evidence readiness;
   the stage maintains a rolling queue, authorizes uncapped hourly blogs, and
   persists up to five diversified daily social stories on the first run after
   06:00 America/New_York. Every News-qualified story is also a blog. A ranking cannot reach
   Agent 04 until an explicit hash-bound production authorization exists. The
   bounded hourly official-first pass prioritizes urgent, app News, hourly blog, then daily social
   candidates. Unavailable or inconclusive
   checks continue privately through production; a known official contradiction
   blocks both blog and social.
5. Slack is allowed only for an important, material, message-changing conflict
   after verification is exhausted. Signed Process/Skip/Hold actions are audited
   and idempotent.
6. Agent 04 generates four distinct, claim-traceable concepts and selects one
   qualified-attention promise before writing. It adapts that promise into blog,
   newsletter, YouTube, Instagram, and TikTok headline packs, then creates the
   six-slide copy, narration, captions, app deep link, and production brief.
   Unsupported numbers, superlatives, fabricated experience, and clickbait fail
   validation; full long-form bodies and media remain later work.
7. The isolated Creddy Video Factory runtime at
   `/Users/mohitkourav/Code/video-factory-creddy` uses the official
   `thebrewapps/video-factory` cream/gold templates, supplied mascot pose pack,
   editorial theme, and approved cloned-voice reference. It also supports the
   text-plus-licensed-music format and constrains output for safe Blotato upload.
8. Completed social formats enter a social-only Creddy Content Bank record, while
   each website article has one stable independent article record. Authenticated staff can
   preview videos and evidence, approve destinations/times, request revisions, and
   drag pending posts across a seven-day calendar.
   Blog release may proceed when verification is unavailable or inconclusive;
   unresolved social requires a separate audited **Facts verified and approve**
   action, which resets whenever the content revision changes.
9. Revision requests create fresh versioned render jobs; old renders cannot be
   approved as the revised asset.
10. Normal scheduled destinations require human approval. A strictly bounded,
    fully official-verified breaking item may use an audited `auto_urgent`
    authorization when its separate fail-closed flag is enabled. Submission IDs and
    remote status are reconciled idempotently; missed windows fail for review.
11. The same Agent 04–08 record now supports a complete `creddy-copy-v3`
    website article, claim-traced article visuals, a private getcreddy.com-themed
    HTML preview, independent human article approval, and a fail-closed website
    export boundary. It does not create a second pipeline or duplicate content ID.

## Isolation and safety

- `CREDDY_PIPELINE_ENABLED=false` remains the safe stored default; scheduled
  runs scope it to true only for their own commands without changing the file.
- Existing MinuteWise/Roast AI entrypoints, posting, analytics, and runtime data
  were not changed by the Creddy implementation.
- Every filesystem write is contained under the configured absolute Creddy data
  root, uses atomic JSON replacement, and stage workers use locks.
- API keys remain server-only and error messages redact provider keys.
- The supplied Creddy anon key is optional and read-only; no Creddy service-role
  access is required by the file-first MVP.
- This hourly News-to-blog policy uses the existing Supabase contract and needs
  no schema, Cron, or Edge Function migration.
- Live local Video Factory verification was completed. Publishing remains gated,
  so no Blotato post was created by this template/voice test.

## Scheduled task

The replacement design uses one hourly Codex task for the entire workflow. The
social-only daily selection gate is internal and timezone-aware; News and blogs
do not wait for it. App News is a projection of
the shared ledger rather than a second recurring collector. The task must not be
created or activated until this code is merged and the activation checklist is
approved. See `docs/CREDDY-SCHEDULED-TASKS.md` for the exact sequence.

The two Codex reasoning stages use signed-in Codex task usage, not OpenAI API
billing. `OPENAI_API_KEY` is needed only if the team deliberately switches
`CREDDY_AI_EXECUTION_MODE` to `openai_api` later. Firecrawl and Blotato still use
their own provider keys and credits.

## Verified

- 257 Creddy and 29 News automated unit/integration tests pass.
- Root TypeScript type-check passes.
- Changed dashboard files pass TypeScript and ESLint.
- Next.js 16 dashboard production build passes with its Webpack fallback.
- Video Factory Python files parse successfully and its Chatterbox/HyperFrames
  production dependencies are installed under Python 3.12.
- A cloned-voice Creddy production render completed successfully at 1080x1920,
  17.4 seconds, H.264/AAC, 3.5 MB.
- Config validation confirms 18 enabled sources, 12 rotating searches (six active
  per editorial window), and 23 OR keywords.
- Pipeline status resolves the dedicated data root and reports empty queues while
  disabled.

The repository-wide lint/diff check still reports a pre-existing issue in
`dashboard/src/components/mobile-sidebar.tsx` and trailing whitespace in a modified
Roast AI runtime log. Neither belongs to this implementation and neither was
changed.

## Inputs required before activation

1. Slack bot token, signing secret, approval channel ID, and a reachable dashboard
   callback URL. The signing secret must also be available to the dashboard.
2. A licensed background-music file and its absolute path.
3. ~~Approved Chatterbox reference recording~~ — supplied and installed as a
   20-second, 24 kHz mono local reference; cloned-voice generation is verified.
4. Exact Creddy Instagram account mapping in Blotato.
5. A created and connected Creddy TikTok account plus its Blotato mapping.
6. Approved iOS App Store URL, Google Play URL, and final Creddy deep-link routes.
7. Approval of the single hourly Codex automation and local filesystem access to
   both the code project and the dedicated data project on the Mac mini.
8. A single staging render and private/test publish. Only after it is reviewed
   should `CREDDY_PIPELINE_ENABLED` be changed to `true` and schedules resumed.

`SUPABASE_SERVICE_ROLE_KEY` is not an activation blocker for this file-first MVP.
It is needed only if the optional database mirror/migration is enabled. Apify,
ScrapeCreators, and Virlo are also not required for the initial loop; analytics
learning remains the approved later phase.
