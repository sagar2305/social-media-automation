# Creddy scheduled-task runbook

The pipeline uses separate Codex scheduled tasks so each stage has a durable input,
output, manifest, and retry boundary. Scheduled analysis and content generation use
Codex task usage; they do not require `OPENAI_API_KEY`. Firecrawl and Blotato remain
external APIs and use their own keys.

1. **Agent 01 — Collect** — twice daily for 18 enabled sources and six of 12 rotating focused topic searches per editorial window. Run it with `npm run creddy:pipeline -- agent-1`; the command collects and writes both latest and immutable run-scoped reports before returning.
2. **Agent 02 — Clean, verify, and deduplicate** — applies US/travel-rewards safeguards, removes boilerplate and duplicates, and preserves evidence.
3. **Agent 03 — Rank, select, and officially verify** — applies the `creddy-ranking-v3` viral rubric, predicts channel fit, persists a diversified five-story slate, and performs a bounded official-first verification pass only for that slate. Every result is recorded per item and never stops private production: unavailable/inconclusive stories carry a social factual-approval gate, while known conflicts remain visible in final review and block both release paths until corrected.
4. **Agent 04 — Select the concept and write content** — generates four claim-traceable angles, selects one consumer-advocate promise, and writes one unified package: complete structured website article, headline adaptations, six-slide copy, narration, captions, CTA, sources, and production brief.
5. **Agent 05 — Plan visuals** — chooses the supported social theme, scenes, and mascot expressions plus 3–8 claim-traced 16:9 website article assets using `creddy-abstract-editorial-v1`, without changing accepted copy or claims.
6. **Agent 06 — Assemble production** — builds the themed private article preview and renders exactly one text+music and one narrated video per package. Article asset gaps remain explicit without duplicating valid social jobs.
7. **Agent 07 — Fill the Content Bank** — keeps article and social formats on the same stable content identity, creates human-review records, and sends each new six-slide review to Slack exactly once. Website and social approvals are independent: blog may continue after unavailable/inconclusive verification, while unresolved social requires the audited **Facts verified and approve** action.
8. **Agent 08 — Publish/export** — polls only human-approved social schedule entries for Blotato and separately exports asset-complete, human-approved website articles for the disabled getcreddy.com integration boundary.

Known official conflicts remain retained, not discarded. An editor can create an
audited correction request and run `npm run creddy:pipeline -- reopen-official-conflict <file>`.
That requeues the same canonical item for Agent 03 correction and official
reverification; changed claims and gates then deterministically requeue Agents
04–07 before either release path can reopen.

Agent 7's routine review notification uses the configured Slack Socket Mode app.
Every new review includes all six slides and human decision controls. A separate
rare-review path may still report unresolved, message-changing material source
conflicts before production.

## Active schedule (America/New_York)

| Agent | Times | Visible output |
|---:|---|---|
| 01 | 08:00 and 18:00 | `01-discovery-and-collection.md` plus raw/discovery files |
| 02 | 08:20 and 18:20 | `02-filtering-and-deduplication.md` |
| 03 | 08:35 and 18:35 | `03-ranking-and-routing.md` with every score, hook, channel prediction, persisted diversified slate, official result, and social gate |
| 04 | 09:30 and 19:30 | `04-content-writing.md` with four concept candidates, selection reasons, headline pack, copy, and claim-safety status |
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
