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
assets. Inspect prompts, alt text, claim fields, provenance, and hero identity.
Reject fake UI, logos, generated text, or generic synthetic advertising imagery.

## 3. Article assets

Generate, compose, or supply each approved Agent 05 asset. Store only approved
absolute paths in `articleVisuals.assets[].assetPath`; store provenance for
licensed, composed, and supplied assets. Reaccept the visual record.

For assets marked `generationMode: generate`, run
`npm run creddy:pipeline -- agent-6-article-images`. The command generates only
missing approved assets, validates the returned image container, stores it under
the Creddy data root, records model provenance, and refreshes Agent 06 assembly.

Pass when every file exists, the hero is 16:9, inline assets match their blocks,
and visuals remain truthful to the accepted claims.

## 4. Agent 06 — assembly and private preview

Run `npm run creddy:pipeline -- agent-6-prepare`. Open the generated private HTML
preview from the Content Bank after handoff. Run `agent-6-render` separately only
when Video Factory, cloned voice, and licensed music are ready.

Pass when article readiness is `ready_for_review`, the preview matches
`creddy-guides-v1`, links and blocks are complete, and the two social video jobs
remain idempotent.

## 5. Agent 07 — one Content Bank identity

Run `npm run creddy:pipeline -- agent-7-bank`, then open the existing Creddy
Content Bank slideshow item. Review the article card, themed preview, six slides,
captions, sources, claims, CTAs, disclosure, and asset blockers.

Pass when the article and social assets share the same canonical opportunity,
article approval is independent, and no external publish occurs. Use **Approve
website article** only after the private preview is accepted.

## 6. Agent 08 — safe website export

Create a protected referral registry and set `CREDDY_REFERRAL_REGISTRY_PATH`.
Every referral card ID in the article must resolve to one active approved record.
Run `npm run creddy:pipeline -- agent-8-website-export`.

Pass when one `14-website-ready/<slug>.json` payload is produced with the exact
approved article, visual paths, disclosure, referral destinations, design tokens,
and `/guides/<slug>` route. Missing approval, assets, preview, or referral IDs
must fail closed.

## 7. Final getcreddy.com staging integration

Do this only after steps 1–6 pass. Connect the export payload to the actual
getcreddy.com repository or authenticated CMS API, publish to a staging/preview
URL, compare desktop and mobile against the live Guides theme, test consent and
unsubscribe end to end, then request final human production approval.
