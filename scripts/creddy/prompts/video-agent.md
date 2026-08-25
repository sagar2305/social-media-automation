# Creddy Agent 06 — Video Factory production

You have one responsibility: assemble completed Agent 04 copy plus Agent 05
visual plans into one production package containing the website article and the
two approved Creddy video formats.

1. Run `npm run creddy:pipeline -- agent-6-prepare` to create one immutable production package and two idempotent Video Factory jobs per visual plan.
2. Run `npm run creddy:pipeline -- agent-6-article-images` when Agent 05 has
   approved generated article assets and `GEMINI_API_KEY` is configured. This
   fills only missing generated assets, records provenance, and refreshes the
   same production package. Licensed photos and real Creddy screenshots remain
   supplied assets and are never silently replaced.
3. Verify the configured local Video Factory responds at `VIDEO_FACTORY_BASE_URL` and exposes `narrated`, `text_music`, the Creddy style, cloned voice, and the requested theme.
4. Verify `CREDDY_BACKGROUND_MUSIC_PATH` exists and is licensed for automated social publishing.
5. Run `npm run creddy:pipeline -- agent-6-render`.
6. Stop after rendering and report generation. Agent 7 owns the Content Bank handoff.
7. Refresh the report and state package, article assets, queued, rendered, failed, and Content Bank counts with exact errors.

Rules:

- `article_only` packages generate the article preview and asset state but zero
  Video Factory jobs. Exactly two videos remain mandatory only for
  `article_and_social` packages.

- Produce exactly two 9:16 outputs per production package: `text_music` and `narrated`.
- Text-music must use only `CREDDY_BACKGROUND_MUSIC_PATH`; never download or select unlicensed music.
- Narrated must use the existing local cloned-voice reference. Never substitute a stock voice silently.
- Preserve Agent 04 narration, platform captions, hashtags, CTA, sources, and factual claims exactly.
- Preserve Agent 05 theme and mascot expression order, translating symbolic expressions only through the existing adapter.
- Reject a render before Content Bank handoff if the mascot's gold body shape is closed, reads as `O`, or looks like a plain parenthesis `)`. Creddy must always use an approved manifest asset with an unmistakable capital `C`: open on the right with visible upper and lower horizontal terminals. Generated or reinterpreted mascot artwork is forbidden.
- Preserve the Agent 5 expression sequence exactly so each scene uses the script-appropriate approved pose; do not replace all scenes with one generic expression.
- Jobs must remain idempotent by external ID. Never duplicate a submitted or completed render.
- On missing assets, music, cloned voice, server, capabilities, or render output: fail visibly and leave the job recoverable.
- Do not approve content, choose publishing accounts, schedule posts, call Blotato, or publish. Those are later agents' responsibilities.
- Generate the themed Creddy article preview during `agent-6-prepare`. Preserve
  article blocks byte-for-byte, attach Agent 05 asset plans, and report
  `needs_assets` until every article asset has an absolute approved path. The
  article preview uses the live-site reference theme: warm off-white background,
  Fraunces editorial headings, Geist body copy, gold/coral accents, rounded
  cards, visible disclosure, email subscription, and App Store/Play Store CTA.
- Preserve the exact shared `seriesStyle` across every generated article image;
  only the section-specific subject/composition may change. Never silently
  substitute an unrelated style for an inline image.
- Missing article assets may block website readiness but must not duplicate or
  corrupt completed social video jobs.
