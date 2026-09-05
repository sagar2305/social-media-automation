# Photo-first editorial pilot

This extends the existing image pipeline. It does not add a schedule, provider,
database migration, or native-app layout change. Do not replace published images
until the three representative previews and website layout are approved.

## Selection

- `agent-5-prepare` exposes a separate `editorialPhotos` list with exact subjects,
  archive dates, usage notes, creator, source, license and focal point.
- Agent 05 explicitly chooses one `photoAssetId` for a `licensed_photo` hero using
  `generationMode: compose`. It must omit `brandAssetIds` for that asset.
- Brand-name matching never chooses a photograph. A mention of Hilton does not
  establish that Hilton Hawaiian Village is the subject of the story.
- An archive photo can illustrate a program story if its exact subject/date are
  clearly identified. It cannot establish current amenities, routes, pricing,
  award availability or offer eligibility.
- Inline and comparison images retain their existing behavior. Do not duplicate
  the hero merely to populate all three image slots.
- Missing suitable imagery uses the existing approved brand or flat fallback.
  Invalid explicit photo IDs fail that task safely and remain retryable.

## Sources and rights

The three local originals are listed in
`assets/creddy/editorial-photos/registry.json`. Hilton Waikiki and Marriott St.
Kitts are CC0; the KLM photograph is CC BY-SA 4.0. The resulting KLM crop remains
CC BY-SA 4.0. This image license does not relicense unrelated application code.
Each registry entry links to the file description and license. Integrity checks
reject changed bytes, unsafe paths, animated/vector files and insufficient detail.

The website must render creator, source and license links, plus modification
disclosure, on the listing and article. Deploy the companion website PR before
activating photo selection. Attribution stored only in provenance is not enough.
Attribution-required photographs use the existing Creddy sharing image instead
in Open Graph, Twitter and article JSON-LD; CC0 images may be shared directly.
The pilot keeps News on its independent existing brand-image path because its
public attribution surface has not been changed. Do not send attribution-required
photos to native News, Slack-only imagery, or other unverified surfaces.

## Review and rollout

1. Review desktop and mobile magazine-layout screenshots with licensed images.
2. Approve the three hero treatments or request revisions.
3. Merge/deploy website credit support before enabling the pipeline change.
4. Start with a single published blog after approval, verify visible source and
   license links and unchanged copy/dates, then plan any requested archive refresh.
5. Preserve preimages and use existing compare-and-swap refresh safeguards.

No live image backfill is performed by this implementation. The stored pipeline
flag and the one hourly schedule remain unchanged.
