# Creddy editorial imagery

Blogs and App News use recognizable, authentic brand assets in restrained 2D
editorial compositions. No generated logos, invented card designs, glossy 3D
coins, or toy-aircraft illustrations. Existing website frames and social
templates are unchanged. A logo identifies coverage; it never asserts a
partnership, sponsorship, benefit, or transfer relationship.

## Source assets

`assets/creddy/editorial-brands/registry.json` is the reviewed source registry.
Each entry records the exact source, editorial-use provenance, aliases, and
SHA-256 of its local raster. Original SVG captures are retained in `sources/`.
The compositor checks integrity, dimensions, static format and contrast. It
preserves source geometry/colors and never enlarges a small raster. White marks
have an explicitly documented backing. Registry presence does not confer
ownership or a blanket license over a third-party trademark. Review each new
asset's source and permitted context; scraped publisher metadata is not consent.

Agent 05 chooses up to four explicit `brandAssetIds` for each article visual in
`generationMode: compose`. `[]` requests an original flat editorial fallback.
The existing CMS contract is exactly three 16:9 assets. Agent 06 renders at
1600x900; inspect hero and section images at 320px width. Product-specific card
art must match that exact card, not merely its issuer. Supplied licensed photos
and real product captures remain supported with provenance.

News matches explicit names in its headline/summary against the same registry.
It publishes text promptly even when an image is missing or fails. Image repair
uses `reports/news-image-pending/`, with at most five least-recently-attempted
items per existing hourly News pass. Repairs only touch already-published
images, use current revisions, and confirm Slack receipts; they never authorize
a story, revive deleted News, or overwrite unreviewed existing imagery. Normal
social still requires Slack review. No new scheduler, Cron, or Edge Function.

## Image-only archive refresh

Use the protected environment without logging its values. Neither command
changes any stored feature flag. Planning reads published CMS/News rows and
renders previews locally; only `apply` uploads or edits published images.

```sh
npm run creddy:editorial-images -- plan
# Inspect the returned plan and local preview images, including coverage gaps.
npm run creddy:editorial-images -- apply /absolute/path/to/plan.json
```

Use a single-item canary before a full archive refresh. New content-addressed
WebP files must stay under `creddy-blog-assets/blogs/`, the website's existing
allowlisted prefix. A new image URL avoids stale mobile/CDN caches; no new mobile
build is required by this image-only change.

Blogs use an image-only content/hash update with the expected content SHA and
published-state checks. News uses `creddy_news_set_image`, a service-role-only,
SECURITY INVOKER RPC in the app repository. Its existing trigger updates the
public feed revision and its audit preserves old content. The RPC migration is
`20260905045541_creddy_news_image_refresh.sql`; it was applied via Supabase MCP.
Publication dates, titles, slugs, article prose, approval state and News source
evidence are preserved. Internal edit/feed revisions may advance.

Reports live under `reports/editorial-image-refresh/<id>/` and
`reports/blog-image-refresh/`. Keep the plan, first preimages and per-attempt
results. Old image objects are never deleted. Reapply the same plan to reconcile
an already-applied image's cache/Slack receipt. A genuine intervening edit stays
retryable and requires a newly reviewed plan; never automatically rebase it.
Unmatched News remains in the durable image queue. Brand-less blogs get a flat
fallback, and the coverage report identifies them separately.

For rollback, restore only the old image metadata from the saved preimage using
a fresh current revision/hash guard. Never overwrite a whole article row from
an old backup or delete newly uploaded files while references may remain.

## Verification and follow-up

- Run `npm run creddy:validate`, `npm run creddy:test`, `npx tsc --noEmit` and the
  app repository's isolated News image migration SQL test.
- Confirm the live article resolves, its image loads, its date is unchanged,
  and the News public feed image/revision plus Slack receipt match the update.
- Preserve descriptive alt text and compressed large images. Existing article
  metadata already supplies the hero as its share image. Consider enabling
  `max-image-preview:large` separately after auditing website metadata.
- Expand approved photography and exact product imagery where useful. Measure
  thumbnail click-through and article engagement; do not promise SEO gains from
  logos alone. Review expired offers and overlapping stories as separate content
  quality work, not as a side effect of an image refresh.
