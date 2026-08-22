# Creddy scheduled-task runbook

The pipeline uses separate Codex scheduled tasks so each stage has a durable input,
output, manifest, and retry boundary. Scheduled analysis and content generation use
Codex task usage; they do not require `OPENAI_API_KEY`. Firecrawl and Blotato remain
external APIs and use their own keys.

1. **Agent 01 — Collect** — twice daily for all 13 approved sources plus four topic searches. Run it with `npm run creddy:pipeline -- agent-1`; the command collects and writes both latest and immutable run-scoped reports before returning.
2. **Agent 02 — Clean, verify, and deduplicate** — applies US/travel-rewards safeguards, removes boilerplate and duplicates, and preserves evidence.
3. **Agent 03 — Rank and route** — scores product fit, editorial popularity, importance, and confidence, then makes the deterministic route decision.
4. **Agent 04 — Write copy** — creates scripts, narration, platform captions, CTA, claims, sources, and production briefs only.
5. **Agent 05 — Plan visuals** — chooses the supported Creddy theme, scenes, and mascot expressions without changing accepted copy or claims.
6. **Agent 06 — Produce videos** — Video Factory renders exactly one text+music and one narrated video per package, then stops.
7. **Agent 07 — Fill the Content Bank** — pairs matching completed revisions and creates `pending_review` records. It never approves, rejects, schedules, or publishes.
8. **Agent 08 — Publish** — polls only human-approved schedule entries and submits them to Blotato inside the configured lead window.

The separate rare Slack task is an exception path, not a routine pipeline agent. It
posts only unresolved, message-changing material source conflicts and remains paused
until Slack credentials are configured.

## Active schedule (America/New_York)

| Agent | Times | Visible output |
|---:|---|---|
| 01 | 08:00 and 18:00 | `01-discovery-and-collection.md` plus raw/discovery files |
| 02 | 08:20 and 18:20 | `02-filtering-and-deduplication.md` |
| 03 | 08:35 and 18:35 | `03-ranking-and-routing.md` with every score and reason |
| 04 | 09:30 and 19:30 | `04-content-writing.md` |
| 05 | 10:00 and 20:00 | `05-visual-planning.md` |
| 06 | 10:30, 11:30, 12:30 and 20:30, 21:30, 22:30 | `06-video-production.md`; repeated runs reconcile asynchronous renders idempotently |
| 07 | 11:00, 12:00, 13:00 and 21:00, 22:00, 23:00 | `07-content-bank-review.md`; complete pairs become visible on the dashboard |
| 08 | Every five minutes when enabled | `08-publishing.md`; currently paused pending real account mappings and staging verification |

Every run must also end with a visible Codex task summary. That summary states
success, failure, or no-op; exact counts and paths; representative outputs; blockers;
and readiness of the next agent. `reports/latest/README.md` is the cross-stage audit
index for the user and boss.

The filesystem is the durable source of truth. Chat summaries are only a convenient
view. Agent 01 stores the discovery ledger in `00-discovery`, full extracted article
text and provider metadata in `01-raw`, its manifest in `manifests`, the current
human-readable report in `reports/latest/01-discovery-and-collection.md`, and an
immutable report plus raw-article index in `reports/runs/<run-id>/`. Later agents
must follow the same pattern: machine-readable stage output, manifest, latest report,
and run-scoped report so fetched, filtered, ranked, written, rendered, and portal
handoff data can be inspected locally at every boundary.

All tasks must remain paused while `CREDDY_PIPELINE_ENABLED=false`. Before activation,
provide licensed music, a Chatterbox reference voice, real Instagram/TikTok Blotato
account mappings, Slack app credentials/channel, dashboard URL, and app deep-link
fallback URLs. Start Video Factory and confirm both advertised audio modes. Apply the
Creddy Supabase migration only when database mirroring is enabled; the file-first
pipeline itself does not need the service-role key.

Every stage is idempotent and guarded by a lock. Failed items stay in their current
queue with a manifest error; a later run may retry without duplicating successful
outputs. Never enable publishing until a staging item has passed the full approval
flow and the remote Blotato account mapping is verified.

Blotato accepts local base64 videos only up to a safe 12 MB binary limit. The
publisher fails closed above that size instead of creating a broken post. Larger
renders must be reduced or placed on an approved public media host before the
fully automatic publish task is enabled.
