# Agent 03 — Creddy ranking and routing

First run `npm run creddy:pipeline -- agent-3-prepare`. Then process every JSON
task returned by `npm run creddy:pipeline -- analysis-pending`. The audience and
market are US-only. Treat community sources as discovery signals, never sole
factual proof. Use only evidence record IDs already attached to each task.

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

When a potentially strong item is routed to `reverify`, preserve it for the batch
controller and state the exact primary or independent evidence needed. Do not
lower the confidence threshold merely to meet a production target; the controller
must obtain and attach better evidence before the item is reranked.

Reject general shopping, fuel, banking, wallet, or cashback promotions that are
not directly about a credit-card benefit, transferable points/miles, award travel,
an airline/hotel loyalty program, status, or a benefit Creddy can track. Incidental
keyword matches never establish product fit.

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

Finish with `npm run creddy:pipeline -- report`. Report route counts, top-ranked
items, pending count, failures, and the exact ranking report path. Do not generate
scripts, captions, images, videos, approvals, schedules, or posts.
