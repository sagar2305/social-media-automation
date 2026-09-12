# Editorial workflow repair, September 7, 2026

## Findings and repairs

- PR #46 closed when its base branch was deleted. Replacement #47 merged at
  `9efd462` and contains its fresh online photo sourcing. The image work is not lost.
- News ingest intentionally retains published rows. This left a rolling TPG URL
  showing an older donation headline while Agent 03 had accepted September deals.
  Added a separate service-only, row-locked, revision-checked text reconciliation
  RPC. Current eligibility is checked before calling it. Exact canonical/analysis
  and source identity must match; human edits and deleted rows remain protected.
- News synchronization preserves dates and images, audits previous content,
  updates current provenance and increments feed/Slack revision only for changed
  display text. Previous provenance is not a separate history in this RPC.
- Delivery receipts compare editorial text rather than independent image/date
  fields. Retained mismatched content is explicitly reported for editorial review.
- Already-finalized social bank entries were revalidated against mutable current
  plans. One scheduled historical item was therefore repeatedly reported failed.
  Finalized entries now skip early, with a separate count. Pending items still fail
  closed on bad copy, renders or authorization.

## Verification and rollout

- Full suite: 352 tests pass; TypeScript, config and whitespace checks pass.
- App migration `20260907000029_news_pipeline_sync.sql` applied with Supabase MCP.
  Transactional regression fixtures rolled back, leaving no test News behind.
- Database checks cover public projection, revision invalidation, date/image
  preservation, idempotency, stale revision, wrong identity, human edits,
  tombstones and denied anonymous/authenticated execution.
- Supervised current-policy repair: 3 existing News observed, 2 changed, 1 unchanged,
  no failed or withheld items. TPG September-deals item is revision 3; JAL/Hilton
  transfer-bonus item is revision 4. Public feed and matching Slack revisions verified.
  Immediate live retry observed all 3 unchanged, with no new revision or failure.
- No mobile build, UI change, Cron, Edge Function or additional schedule is needed.
  Merge the pipeline PR to activate reconciliation in normal hourly runs.
- The stored pipeline flag is unchanged. True was scoped only to supervised commands.
- An interrupted hourly lease was marked failed with a sanitized reason before
  repair; its pending ranking and durable queues remain available for the next run.

## Remaining work, not hidden by this patch

- 18 existing production packages have changed evidence or authorization. They
  require fresh reviewed revisions with new approval state. Overwriting old
  bindings would invalidate the safety model; this patch does not do so.
- 33 pending-review slideshow failures remain, distinct from the one false
  scheduled-item failure fixed above. Repair requires their current copy/render
  and authorization, not blanket approval or deletion.
- Recent Reddit collection attempts returned HTTP 403/429. Other configured
  publisher collection continues. Treat source availability as per-run status.
- Security advisors also list unrelated existing Auth/table-policy notices,
  including disabled leaked-password protection. Review separately using the
  [Supabase password-security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Durable live results: protected data root `reports/workflow-repair-2026-09-07/`.
