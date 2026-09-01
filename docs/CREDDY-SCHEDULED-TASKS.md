# Creddy hourly editorial workflow

Creddy uses exactly **one hourly Codex scheduled task**. It orchestrates Agents
01–08, the app News projection, and the rolling editorial ledger. Do not create a
schedule per agent and do not schedule the standalone News repair CLI.

The filesystem remains the durable source of truth. Every stage is idempotent,
uses its existing lock/manifest boundary, and may safely no-op. A two-hour lease
prevents overlapping hourly runs; an interrupted lease becomes recoverable on a
later tick.

## Editorial cadence

- Every hour: collect, clean, deduplicate, rank only new or materially changed
  inputs, recompute freshness, publish attributed News from configured specialist
  publications, and verify only exceptional News/urgent/daily candidates.
- First successful run after **06:00 America/New_York**: persist one diversified
  daily slate of up to five qualifying stories after the ranking queue is clean.
  Zero is valid. A 09:00 ET fallback records remaining blockers so one poisoned
  task cannot freeze the day. The selection is then stable.
- Breaking lane: fresh official evidence or agreement between two independent
  configured specialist publications may receive an audited `auto_urgent`
  authorization. Safety budgets are two urgent blogs per New York day and one
  urgent Instagram+TikTok package per rolling six hours.
- Normal daily social remains in Slack human review. Trusted-source blogs do not
  require routine official re-verification. A known conflict blocks both.

Freshness horizons are deterministic: breaking content hard-expires after 72
hours (and qualifies for urgent treatment only within six hours), time-sensitive
content at its deadline or seven days, timely content after 14 days, and evergreen
content after 180 days. Evergreen facts require a fresh official check every 30
days. Unchanged content is not re-ranked hourly; a changed content/evidence hash
requeues only that canonical item.

Official-check retries are bounded: conflicts require correction, inconclusive
checks wait 24 hours, and unavailable pages back off for six hours on the first
retry and 24 hours thereafter. A changed evidence hash creates a fresh task.

## Agent responsibilities

1. **Agent 01 — Discovery:** hourly collection across approved publishers,
   communities, creators, and rotating searches. Listings/feeds run hourly, while
   known article bodies are rechecked at most daily; new URLs are immediate.
2. **Agent 02 — Qualification:** US/travel-rewards filtering, article-body
   cleaning, exact/near duplicate handling, and evidence grouping.
3. **Agent 03 — Ranking:** independent ranking-v3 scores, channel potential,
   event time, freshness class, material-event classification, and claim-level
   evidence. A ranking is a candidate, never permission to create assets.
4. **Exceptional verification gate:** checks up to five highest-priority
   exceptions per hourly pass, ordered urgent, app News, then daily. Configured
   specialist publications do not enter this queue merely because an official
   page was not checked. Failure is retained and reported; it never aborts the
   remaining queue.
5. **Agent 04 — Copy:** runs only for an explicit, hash-bound production
   authorization and produces the unified article/social package.
6. **Agent 05 — Visual plan:** creates claim-traced article and six-slide plans
   without altering approved facts or copy.
7. **Agent 06 — Production:** creates article images/previews and both social
   formats idempotently.
8. **Agent 07 — Review/delivery:** sends normal review to Slack once. A current
   `auto_urgent` authorization may bypass human review only when the relevant
   fail-closed feature flag is enabled and all frozen hashes still match.
9. **Agent 08 — Reconciliation:** publishes/exports only valid approved or
   auto-urgent records and independently reconciles Instagram and TikTok.
10. **App News projection:** publishes every eligible attributed item from a
    configured specialist publication (no daily cap) and posts it to Slack.
    The feed uses a provenance-labeled first-seen timestamp while retaining any
    publisher date separately. News never waits for 06:00. Actual conflict/high-risk failures
    appear in one idempotent hourly Slack digest, not as a message flood.

## Exact scheduled-task sequence

The task runs from the repository root with the protected `.env.local` already
installed. Never display secret values.

1. Run `npm run creddy:validate` and `npm run creddy:test`.
2. Run `npm run creddy:pipeline -- hourly-prepare`. If `started` is false, report
   the active lease and stop successfully. Otherwise retain the returned `runId`.
3. Run `analysis-pending`; independently produce and accept every Agent 03 record
   using `scripts/creddy/prompts/analysis-agent.md`. Heartbeat between long groups.
4. Run `hourly-route <runId>`. This creates the bounded official-verification
   tasks and safely processes already-current verification results.
5. Run `official-verification-pending`; verify and accept every returned task by
   its exact task ID. A per-item failure is logged and skipped, not fatal.
6. Run `hourly-route <runId>` again. This freezes eligible authorizations,
   publishes eligible app News, and emits the withheld digest.
7. Run `hourly-heartbeat <runId>`, then drain only explicitly authorized Agent
   04–05 queues. Run another heartbeat before Agent 06 rendering/polling, before
   Agent 07 Content Bank/Slack work, and before Agent 08 reconciliation. Use the
   existing copy, visual, image, render, Content Bank, website, and publishing
   commands. Never scan completed rankings as production input.
8. Run `rolling-status`, then `npm run creddy:pipeline -- report`.
9. Run `hourly-finish <runId>`. On an unhandled error, first attempt
   `hourly-fail <runId> <redacted reason>`, report durable paths, and leave all
   item queues retryable.

## Activation gates

The code and schedule definition do not activate delivery. Keep
`CREDDY_PIPELINE_ENABLED=false` until the merged commit has passed a supervised
dry run. Keep both urgent flags false until their separate staging checks pass:

```dotenv
CREDDY_URGENT_BLOG_AUTOPUBLISH_ENABLED=false
CREDDY_URGENT_SOCIAL_AUTOPUBLISH_ENABLED=false
CREDDY_URGENT_INSTAGRAM_ACCOUNT=
CREDDY_URGENT_TIKTOK_ACCOUNT=
```

Urgent blog delivery additionally requires the existing CMS publishing gate.
Urgent social requires both account mappings and Blotato credentials. A mutation
revalidates authorization expiry, ranking input hash, decision hash, official
verification hash, official-check age, content binding, and output-specific
verification immediately before delivery.

This workflow requires no new Supabase migration, database Cron, Edge Function,
queue service, or second scheduler. The existing app News schema remains the only
database boundary.
