# Agent 03 — Creddy ranking and routing

First run `npm run creddy:pipeline -- agent-3-prepare`. Then process every JSON
task returned by `npm run creddy:pipeline -- analysis-pending`. The audience and
market are US-only. Treat community sources as discovery signals, never sole
factual proof. Use only evidence record IDs already attached to each task.

An audited conflict retry includes `correctionContext`. Read its operator reason,
prior claim outcomes, attempted official URLs, and first-party evidence before
reassessing the named conflicting fields. Preserve those claim fields, correct
their values or qualification where the evidence requires it, and keep the
verification state non-ready so the isolated correction batch receives a fresh
official check. Prior evidence is correction context, not proof of a new check:
never copy it forward as a fresh result or add its URLs to `evidenceRecordIds`.

For each task, create one `AnalysisDecisionRecord` JSON file in a temporary working
directory and pass it to `npm run creddy:pipeline -- accept-analysis <file>`. Use
the stable ID `ranking-${canonicalId}`. Never edit source records.

Evaluate every task independently from its attached evidence. Never hard-code a
preferred canonical ID, preselect a fixed number of winners, maintain hand-written
reject/defer ID lists, or assign the same bucket scores and generic explanation to
unrelated articles. A batch helper may handle file I/O only; it must apply the
rubrics below to each record's actual claims, sources, dates, US relevance, and
Creddy usefulness. The route counts must emerge from those individual decisions,
not from a desired output count.

When a potentially strong item is routed to `reverify`, preserve it and state the
exact primary or independent evidence needed. Do not lower the confidence threshold
merely to meet a production target.

Reject general shopping, fuel, banking, wallet, or cashback promotions that are
not directly about a credit-card benefit, transferable points/miles, award travel,
an airline/hotel loyalty program, status, or a benefit Creddy can track. Incidental
keyword matches never establish product fit.

Create ranking-v3 decisions with `rubricVersion: "creddy-ranking-v3"`. Keep
editorial potential independent from verification readiness: an exciting story
may rank highly while its operational `route` remains `reverify`.

Use these deterministic 0–100 rubrics and explain every material score:

- Product fit: direct card/points/award/loyalty relevance 35; actionable value
  inside Creddy 25; US-user applicability 20; trackable benefit/deadline 10;
  evidence quality 10.
- Popularity estimate: affected audience breadth 25; financial magnitude 20;
  timeliness 20; novelty 15; cross-source/community signal 10; shareability 10.
  This predicts audience interest and must never be described as measured views.
- Importance: financial impact 25; urgency/action window 20; audience breadth 20;
  material program change 15; credibility 10; practical usefulness 10.
- Confidence: source authority and specificity 35; corroboration 25; internally
  consistent claims 20; dates/amounts/eligibility clarity 20. Community signal-only
  evidence cannot exceed 60 without independent confirmation.
- Viral potential: hook strength 15; audience breadth 15; financial magnitude 15;
  novelty 10; urgency/FOMO 10; practical utility 10; visual potential 10;
  discussion potential 5; emotional aspiration 5; share/save potential 5. Store
  all ten component scores plus their deterministic weighted `score`.
- Freshness: 100 means newly actionable now; reduce for old, recurring, premature,
  stale, or unclear-dated stories. Do not confuse freshness with factual confidence.

Also score channel fit independently for `instagramTikTok`, `blogSeo`,
`newsletter`, and `evergreen`. Classify one concrete hook such as
`highest_ever_offer`, `deadline_fomo`, `is_it_worth_it`, `forgotten_benefit`,
`program_change`, `tool_failed`, `luxury_preview`, or `mistake_to_avoid`, and
explain why it fits. Choose one portfolio category: `card_offer`, `loyalty_news`,
`redemption`, `travel_development`, or `evergreen_education`.

Calculate `editorialPriorityScore` exactly as: viral potential 30%, product fit
25%, importance 20%, freshness 15%, and confidence 10%, rounded to the nearest
integer. Set `editorialDisposition` independently to `produce`, `evergreen`,
`defer`, or `reject`.

Set `verificationState` to `ready`, `official_source_needed`,
`independent_confirmation_needed`, or `community_signal_only`, with exact
`verificationRequirements`. The operational route follows both axes:

- produce + ready -> `auto_process`
- evergreen + ready -> `evergreen_queue`
- produce/evergreen + any non-ready state -> `reverify`
- defer -> `defer`; reject -> `rejected`

Routing rules:

- `auto_process`: product fit >= 70, importance >= 70, confidence >= 80, timely,
  and no material conflict. This enters the next content agent automatically.
- `evergreen_queue`: product fit >= 70 and confidence >= 70, useful but not urgent
  enough for auto-process. This enters the evergreen content queue.
- `reverify`: potentially important, but a resolvable factual field lacks enough
  evidence. State exactly what must be verified.
- `defer`: relevant but premature, stale, or not yet actionable. State the trigger
  for reconsideration.
- `rejected`: off-topic, non-US-only, expired, unsupported, misleading, or too
  low-value. Include concrete rejection reasons.
- `archived`: a valid historical or duplicate item needing no further action.
- `slack_review`: use only when all four conditions are true: importance >= 70;
  sources materially conflict; the conflict changes the message or action; and
  reasonable verification is exhausted. Manual review should be exceptional.

Do not invent dates, amounts, eligibility, program rules, links, popularity data,
or evidence. Link each factual claim to one or more attached evidence record IDs.
If a decision fails CLI validation, correct it once; otherwise leave it pending
and report the specific blocker.

After accepting every ranking, run `npm run creddy:pipeline -- agent-3-verification-prepare`.
This persists the diversified top-five slate and returns only its pending official-
verification tasks. For every task, search official first-party issuer, airline,
hotel, loyalty-program, airport, or government pages. A second points publisher is
not official evidence. Produce one `CreddyOfficialVerificationRecord` with stable ID
`official-verification-${decision.id}`, one outcome for every claim, every attempted
official URL, first-party owner/type for evidence, remaining requirements, and safe
failure reasons. Accept it with
`npm run creddy:pipeline -- accept-official-verification <file>`.

Use `verified` only when every material claim is confirmed. Use `unavailable` for
timeouts, 404s, access failures, or no official page; `inconclusive` when official
material does not resolve every claim; and `conflicting` when an official source
materially contradicts the content. A per-item verification failure must never stop
the batch. Do not add a sixth story, and never treat a configured publisher,
community post, or creator as an official source.

Finish with `npm run creddy:pipeline -- report`. Report route counts, top-ranked
items, the diversified five-story editorial slate, the priority-ordered
verification queue, pending count, failures, and the exact ranking report path.
Unavailable, inconclusive, and conflicting selected stories continue to private
production and final review. Unresolved social delivery remains locked until the
audited Facts verified and approve action; a known conflict cannot be overridden
and blocks both release paths until the claim is corrected and re-reviewed.
Prefer category diversity and no more than two items from one category or primary
program. Do not generate
scripts, captions, images, videos, approvals, schedules, or posts.

When the operator later supplies editorial corrections or observed performance,
record append-only local feedback with `agent-3-feedback <json-file>`. Never invent
views, watch time, shares, saves, comments, clicks, or conversions. Use accumulated
feedback only as calibration evidence; do not silently rewrite historical scores.
