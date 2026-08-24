# Creddy automation implementation status

**Date:** 19 August 2026
**Code status:** implemented and locally verified
**Production status:** core pipeline active locally; publishing and external review remain gated

## Implemented flow

1. Agent 01 collects the 13 original US-market sources, Geobreeze Travel via YouTube RSS, and four focused topic searches. Reddit and creator feeds bypass Firecrawl when a direct feed is available.
2. Immutable raw files are partitioned by date/run in the dedicated data project.
3. OR-keyword filtering, context checks, cleaning, exact duplicate detection, and
   supporting-evidence grouping produce canonical news records.
4. Codex scheduled analysis assigns importance/confidence and routes each record
   to auto-process, reject/archive/defer, or rare Slack review.
5. Slack is allowed only for an important, material, message-changing conflict
   after verification is exhausted. Signed Process/Skip/Hold actions are audited
   and idempotent.
6. Codex scheduled content generation creates scripts, captions, app deep links,
   briefs, visual prompts, optional generated-image paths, and two versioned video
   jobs without requiring `OPENAI_API_KEY`.
7. The isolated Creddy Video Factory runtime at
   `/Users/mohitkourav/Code/video-factory-creddy` uses the official
   `thebrewapps/video-factory` cream/gold templates, supplied mascot pose pack,
   editorial theme, and approved cloned-voice reference. It also supports the
   text-plus-licensed-music format and constrains output for safe Blotato upload.
8. Both completed formats enter the Creddy Content Bank. Authenticated staff can
   preview videos and evidence, approve destinations/times, request revisions, and
   drag pending posts across a seven-day calendar.
9. Revision requests create fresh versioned render jobs; old renders cannot be
   approved as the revised asset.
10. Only human-approved scheduled destinations reach Blotato. Submission IDs and
    remote status are reconciled idempotently; missed windows fail for review.

## Isolation and safety

- `CREDDY_PIPELINE_ENABLED=false` remains the safe example default; the local
  `.env.local` explicitly enables the Creddy pipeline for controlled testing.
- Existing MinuteWise/Roast AI entrypoints, posting, analytics, and runtime data
  were not changed by the Creddy implementation.
- Every filesystem write is contained under the configured absolute Creddy data
  root, uses atomic JSON replacement, and stage workers use locks.
- API keys remain server-only and error messages redact provider keys.
- The supplied Creddy anon key is optional and read-only; no Creddy service-role
  access is required by the file-first MVP.
- The Supabase migration is additive and remains unapplied.
- Live local Video Factory verification was completed. Publishing remains gated,
  so no Blotato post was created by this template/voice test.

## Scheduled tasks

Eight separate, timezone-anchored Codex automation cards were prepared in paused
state: collection; filtering; dedupe/queue; Codex analysis; rare Slack delivery;
Codex content/image packaging; Video Factory/render-bank polling; and approved
publishing. The app requires the operator to accept the displayed cards. Keep all
of them paused until the activation checklist is complete.

The two Codex reasoning stages use signed-in Codex task usage, not OpenAI API
billing. `OPENAI_API_KEY` is needed only if the team deliberately switches
`CREDDY_AI_EXECUTION_MODE` to `openai_api` later. Firecrawl and Blotato still use
their own provider keys and credits.

## Verified

- 47 automated unit/integration tests pass.
- Root TypeScript type-check passes.
- Changed dashboard files pass TypeScript and ESLint.
- Next.js 16 dashboard production build passes with its Webpack fallback.
- Video Factory Python files parse successfully and its Chatterbox/HyperFrames
  production dependencies are installed under Python 3.12.
- A cloned-voice Creddy production render completed successfully at 1080x1920,
  17.4 seconds, H.264/AAC, 3.5 MB.
- Config validation confirms 13 enabled sources, four searches, and eight OR
  keywords.
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
7. Approval of the eight displayed Codex automation cards and local filesystem
   access to both the code project and the dedicated data project on the Mac mini.
8. A single staging render and private/test publish. Only after it is reviewed
   should `CREDDY_PIPELINE_ENABLED` be changed to `true` and schedules resumed.

`SUPABASE_SERVICE_ROLE_KEY` is not an activation blocker for this file-first MVP.
It is needed only if the optional database mirror/migration is enabled. Apify,
ScrapeCreators, and Virlo are also not required for the initial loop; analytics
learning remains the approved later phase.
