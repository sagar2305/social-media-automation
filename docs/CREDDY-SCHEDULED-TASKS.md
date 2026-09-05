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
  publications, authorize every eligible News item as a blog plus any additional
  qualifying blog stories, and verify only exceptional News/blog/urgent/social candidates.
- First successful run after **06:00 America/New_York**: persist one diversified
  daily **social-only** slate of up to five qualifying stories after the ranking queue is clean.
  Zero is valid. A 09:00 ET fallback records remaining blockers so one poisoned
  task cannot freeze the day. The selection is then stable.
- Breaking lane: fresh official evidence or agreement between two independent
  configured specialist publications may receive an audited `auto_urgent`
  authorization. Safety budgets are two urgent blogs per New York day and one
  urgent Instagram+TikTok package per rolling six hours.
- Normal social remains in Slack human review. News and blogs never wait for the
  06:00 social selection and have no daily cap. Every News-qualified story is
  also authorized for a blog, while other high-quality current stories may be
  blog-only. New routine blog authorizations are limited to the current 72-hour
  first-seen window so activation cannot flood the historical catalog.
  Trusted-source blogs do not require routine official re-verification. A blog
  may publish as soon as its article and approved visuals are ready; it never
  waits for a social slideshow or video. A known conflict blocks every channel.

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
   exceptions per hourly pass, ordered urgent, app News, hourly blog, then daily social. Configured
   specialist publications do not enter this queue merely because an official
   page was not checked. Failure is retained and reported; it never aborts the
   remaining queue.
5. **Agent 04 — Copy:** runs only for an explicit, hash-bound production
   authorization and produces the authorized article or article-and-social package.
6. **Agent 05 — Visual plan:** creates claim-traced article and six-slide plans
   without altering approved facts or copy.
7. **Agent 06 — Production:** creates article images/previews and both social
   formats idempotently.
8. **Agent 07 — Review/delivery:** keeps the article and social Content Bank
   records separate, sends normal social review to Slack once, and lets an
   eligible article publish independently. A current
   `auto_urgent` authorization may bypass human review only when the relevant
   fail-closed feature flag is enabled and all frozen hashes still match.
9. **Agent 08 — Reconciliation:** publishes/exports only valid approved or
   auto-urgent records and independently reconciles Instagram and TikTok.
10. **App News projection:** publishes every eligible attributed item from a
    configured specialist publication (no daily cap) and posts it to Slack.
    The feed uses a provenance-labeled first-seen timestamp while retaining any
    publisher date separately. News never waits for 06:00. Actual conflict/high-risk failures
    appear in one idempotent hourly Slack digest, not as a message flood. Hourly
    reports distinguish newly inserted, changed, notification-reconciled, and
    unchanged published rows;
    the aggregate `published` count remains the number observed as published.
    Policy exclusions are listed in the hourly report; ordinary age/score
    exclusions do not trigger Slack alerts. Verification exceptions and confirmed
    conflicts use the existing deduplicated digest. A confirmed material conflict
    on an existing News item invokes the revision-checked soft-delete operation:
    the row, content, and audit trail remain, but the item disappears from the
    public feed and cannot be automatically republished. Merely aging past the
    72-hour acquisition window never removes historical News.

## Delivery health

The test commands install a test-only fetch guard: fixtures must inject mocked
clients and cannot issue real Slack, CMS, or social HTTP requests merely because
the protected environment was sourced. Never remove this guard to make a test pass.

`reports/latest/06-production-preparation.json` explicitly lists `revisionRequired`
packages when current evidence or authorization differs from an existing package.
They remain pending; preparation cannot relabel old content with fresh permission
or reuse its approvals. Historical slideshow render revisions are audit records,
not active handoff inputs. Existing remote social submission IDs can be reconciled
without recreating their old packages; new delivery still requires all current
approval and verification checks. TikTok inbox delivery is not public publication.

Blogs and News follow [editorial imagery](CREDDY-EDITORIAL-IMAGES.md): use the
reviewed authentic brand registry and flat editorial fallback, not generated
logos or artificial 3D artwork. The existing News stage repairs up to five
durable pending image updates per pass without holding up new News text.
Missing images and confirmed image/Slack repairs are reported separately. When
no reviewed brand matches, use the existing Creddy-owned flat illustration with
truthful owned-image provenance, never an invented logo or unlicensed photo.

`reports/latest/hourly-editorial.json` and `app-news.json` distinguish completed,
disabled, and degraded News processing. A News setup/service failure is retained
as a sanitized retryable failure while already-authorized blog/social queues
continue. A completed hourly lease means orchestration finished; inspect delivery
health and item failures before interpreting it as successful publication.

Rolling status includes a reporting-only `delivery` field alongside authorization
`channels`. Current News receipts live under `reports/news-delivery/`; blogs and
social use their existing CMS, Content Bank, and Slack receipts. Old or unbound
receipts produce unknown/pending status, not evidence of current delivery. Slack
reconciliation is counted only after a confirmed notification revision receipt.
The scheduled test command includes the News regression suite.

## Exact scheduled-task sequence

The task runs from the repository root with the protected `.env.local` already
installed. Never display secret values.

1. After the clean-main/remote preflight, and before sourcing secrets, synchronize
   the checked-in lockfile with `npm ci --ignore-scripts --no-audit --no-fund`.
   Do not change package manifests or the lockfile. If an hourly lease is active,
   leave its dependencies alone and report the active run instead. An install
   failure stops the run before any pipeline mutation. Then source the protected
   environment and run `npm run creddy:validate` and `npm run creddy:test`.
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

The editorial-image rollout adds one image-only RPC migration in the existing
app News schema. It requires no database Cron, Edge Function, queue service, or
second scheduler. The existing app News schema remains the database boundary.
