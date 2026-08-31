# Creddy article flow — supervised one-by-one test

Keep live publishing disabled for the first test. Use one disposable, verified
Agent 03 opportunity and preserve its canonical ID through every step.

## 1. Agent 04 — unified article and social draft

Run `npm run creddy:pipeline -- agent-4-prepare`, create one
`creddy-copy-v3` result with the Agent 04 prompt, then run
`npm run creddy:pipeline -- accept-copy <draft.json>`.

Pass when the saved draft contains the complete structured article, exact claims
and sources, six social scenes, approved CTA, disclosure, Subscribe block, and
Download block. Confirm the old v2 draft was retained under `legacy` when present.

## 2. Agent 05 — social and article visual plan

Run `npm run creddy:pipeline -- agent-5-prepare`, create one visual record, then
run `npm run creddy:pipeline -- accept-visual <visual.json>`.

Pass when the same visual record contains the six-slide plan and 3–8 article
assets. Confirm `imageBlockStyle` is `creddy-abstract-editorial-v1`, every asset
is 16:9, and important subjects remain inside the central 78% safe area. Inspect
prompts, alt text, claim fields, provenance, and hero identity. Reject fake UI,
logos, generated text, generic synthetic advertising imagery, or prompts that
bake the website frame and ornaments into the image.

## 3. Article assets

Generate, compose, or supply each approved Agent 05 asset. Store only approved
absolute paths in `articleVisuals.assets[].assetPath`; store provenance for
licensed, composed, and supplied assets. Reaccept the visual record.

For assets marked `generationMode: generate`, run
`npm run creddy:pipeline -- agent-6-codex-image-requests`. For each request, use
the signed-in Codex built-in image-generation tool once with the exact stored
prompt, copy the selected output into the request's `stagingDirectory`, and
submit one `creddy-codex-image-result-v1` manifest with
`npm run creddy:pipeline -- agent-6-accept-codex-image <manifest.json>`.
The importer verifies the approved prompt fingerprint, accepts only real
10 KB–20 MB PNG/JPEG files with exact 16:9 dimensions, stores the image under
the Creddy data root, records Codex provenance, and refreshes Agent 06 assembly.
This path uses no Gemini or OpenAI API key. If built-in Codex image generation
is unavailable, stop and report the missing asset instead of changing provider.

Pass when every file exists, the hero is 16:9, all inline assets are also 16:9,
and visuals remain truthful to the accepted claims. Raw files contain clean
artwork only; the HTML renderer owns the cream mat, decorations, and caption.

## 4. Agent 06 — assembly and private preview

Run `npm run creddy:pipeline -- agent-6-prepare`. Open the generated private HTML
preview from the Content Bank after handoff. Run `agent-6-render` separately only
when Video Factory, cloned voice, and licensed music are ready.

Pass when article readiness is `ready_for_review`, the preview matches
`creddy-guides-v1`, every article image uses the approved abstract editorial
block on desktop and hides its ornaments below 1100px, links and blocks are
complete, and the two social video jobs remain idempotent.

## 5. Agent 07 — one Content Bank identity

Run `npm run creddy:pipeline -- agent-7-bank`, then open the existing Creddy
Content Bank slideshow item. Review the article card, themed preview, six slides,
captions, sources, claims, CTAs, disclosure, and asset blockers.

Pass when the article and social assets share the same canonical opportunity,
the article automatically invokes Agent 8 after asset validation, and social
approval remains independent.

## 6. Agent 08 — safe website export

Create a protected referral registry and set `CREDDY_REFERRAL_REGISTRY_PATH`.
Every referral card ID in the article must resolve to one active approved record.
Run `npm run creddy:pipeline -- agent-8-website-export`.

Pass when one `14-website-ready/<slug>.json` payload is produced with the exact
approved article, deployable visual paths plus their local source paths,
disclosure, referral destinations, design tokens, and `/blog/<slug>` route.
Missing release fingerprint, assets, preview, or referral IDs
must fail closed.

## 7. One-time website CMS setup

Review and deploy the website migration `20260826170000_creddy_blog_cms.sql`
and the dynamic `/blog` renderer once through the normal Creddy repository
review process. Configure `REVALIDATE_SECRET` in Vercel Preview and Production.
Verify the empty CMS leaves the existing website and local fallback intact.

The older `agent-8-website-sync` and `agent-8-website-pr` commands remain only
for a migration fallback. They are not the normal per-article workflow.

## 8. Automatic CMS publishing

Set the server-only Supabase URL and
service-role key, `CREDDY_WEBSITE_BASE_URL`, and matching revalidation secret.
Enable `CREDDY_WEBSITE_AUTO_PUBLISH=true` and
`CREDDY_WEBSITE_CMS_PUBLISH_ENABLED=true` only after supervised verification.
Agent 7 then invokes `agent-8-website-cms-publish` automatically. Published
items may be deleted and later reposted from the portal or Slack.

For normal and future CMS uploads, keep
`CREDDY_WEBSITE_ASSET_WEBP_ENABLED=true` and
`CREDDY_WEBSITE_ASSET_WEBP_QUALITY=88`. Verify uploaded asset URLs end in
`.webp`, retain exact 16:9 dimensions, and return HTTP 200. Use
`CREDDY_WEBSITE_CMS_FORCE_REPUBLISH=true` only for a supervised one-time
replacement of assets that already have successful receipts; reset it to false
immediately afterward.

Pass when every exact 16:9 image exists in the public immutable asset bucket,
one published row exists for the slug, no private local paths are stored, and
the `/blog`, article, and sitemap paths revalidate. This operation creates no
Git commit, pull request, Vercel deployment, or new website page file.
