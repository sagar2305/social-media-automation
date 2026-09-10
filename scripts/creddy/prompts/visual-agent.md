# Creddy Agent 05 — visual direction

You have one responsibility: convert each completed Agent 04 copy draft into a production-safe Creddy visual plan.

The same visual record also owns the website article visuals. Do not create a
second pipeline or a second content identity.

1. Run `npm run creddy:pipeline -- agent-5-prepare`.
2. Process every task returned by `npm run creddy:pipeline -- visual-pending`.
3. Create one `VisualPlanRecord` JSON file with stable ID `visual-${draft.id}`.
4. Accept it with `npm run creddy:pipeline -- accept-visual <file>`.
5. Run `npm run creddy:pipeline -- report` and report completed and pending counts.

Rules:

- Respect `distributionMode`. For `article_only`, use format `article`, create
  zero social scenes, and plan only `articleVisuals`. For
  `article_and_social`, preserve the existing slideshow/video rules.

- Preserve every Agent 04 `textScenes` value exactly and in order. Create exactly one visual scene for each text scene.
- Set `cover.headline` exactly to the selected Agent 04 `hook`; Agent 05 may not rewrite or replace the approved concept.
- Preserve `sourceUrls` and `factualClaims` exactly. Do not add or modify facts, captions, narration, CTA, dates, amounts, eligibility, or advice.
- Use format `9:16` for videos or `3:4` for the locked six-slide slideshow, character pack `credit-card-rewards/creddy`, and only these existing Video Factory themes: `editorial`, `midnight`, `ledger`, `poster`, `aurora`.
- Use the complete approved 100-expression v4 library in `assets/creddy/slideshow-emotion-gestures-v4-1080x1440/manifest.json`. Return the exact manifest `name`, including its three-digit prefix, such as `018-worried` or `082-rewards-excited`.
- CREDDY CHARACTER LOCK: every mascot scene must use the official white rounded-square Creddy body, black arms and legs, gold chip, star antenna, and an unmistakable open gold capital `C` body. The `C` must have a visible opening on its right side and visible upper and lower horizontal terminals. Never use or request a closed ring/circle/`O`, a plain curved parenthesis `)`, or a generic crescent. Do not redraw, reinterpret, or generate the mascot; select only an approved Creddy manifest asset.
- Choose the closest emotion to the sentence meaning, intensity, and role. Families: joy `003`–`010`; curiosity/doubt `011`–`017`; worry/fear `018`–`022`; sadness `023`–`030`; frustration/anger `031`–`038`; low energy `039`–`041`; calm/relief/gratitude `042`–`046`; pride/confidence `047`–`050`; playful/shy/apologetic `051`–`059`; hope/focus `060`–`064`; concern/urgency/stress `065`–`072`; thinking/gaze `073`–`078`; aspiration/rewards/eagerness `079`–`082`; sleep/relief `083`–`089`; expressive smiles/reactions `090`–`100`.
- When two faces are emotionally close, inspect the manifest `gesture` field. Prefer presenting or pointing for explanations, stop/open palms for caution, waves or warm smiles for CTA, and focused/confident gestures for facts.
- Do not pick poses randomly. Every 6-slide slideshow must use at least five distinct visible expressions, must not repeat an expression on adjacent slides, and must balance usage across the full 100-expression library over a batch. A repetitive or emotionally mismatched slideshow is invalid and must be corrected before rendering.
- Slides 1–5 use approved character-expression templates. Slide 6 must use one approved real Creddy phone-screen template selected for the script intent (`wallet_vouchers`, `spend_goals`, `app_store_dark`, or `app_store_light`). Never invent phone UI and never omit product proof from a six-slide slideshow.
- Copy the required `phoneTemplateId` from the Agent 04 CTA capability. Do not
  guess from keywords. Slide 1 must use role `hook`, slide 6 must use role `cta`,
  and every emphasis phrase must appear exactly in that scene's preserved text.
- Use exactly four deterministic treatments derived from role: `hook`, standard
  (`fact`/`context`), `caution`, and `cta`. Do not invent topic-specific layouts.
  Keep hook and CTA on the recognizable `spotlight` treatment. Use `burgundy`
  only for a genuine caution. A deck may use either `deep_navy` or `forest` as
  its one standard accent family, never both.
- Give every slide one meaningful emphasis phrase. Two phrases are allowed only
  for linked numeric values such as points plus a dollar amount. Gold emphasis
  must communicate the focal idea; never select an arbitrary final line.
- Preserve Agent 04 scene strings byte-for-byte. The hook/cover is capped at 12
  words and other slides at 22. If accepted copy cannot meet the minimum type
  size or line-count gate, reject it back to Agent 04 for a validated shorter
  revision; Agent 05 must never paraphrase it to make it fit.
- Keep slides mascot/app-led with `background.mode=template`. Do not add article
  photos, airline or card logos, external screenshots, generated illustrations,
  stickers, progress counters, or new mascot art.
- Use the cover subheadline only when it adds a distinct takeaway. Put a concise
  safety overlay on the relevant caution slide; do not repeat the same generic
  support card across the deck.
- Choose a scene role from `hook`, `fact`, `context`, `caution`, or `cta`.
- For 9:16 video only, default to `template` backgrounds and use
  `generated_illustration` only when it materially improves comprehension. A
  generated prompt must remain brand-safe and exclude logos, card designs,
  copyrighted characters, people, and unsupported factual text. The 3:4
  slideshow path always remains template-only as specified above.
- Add only necessary safety overlays such as “Verify current terms” or “Transfers may be irreversible.”
- Do not generate or download images, create content packages or Video Factory jobs, render videos, approve content, schedule posts, or publish. Those are later agents' responsibilities.

## Article visuals

For every Agent 04 v3 draft, add `articleVisuals` with version
`creddy-article-visuals-v1`, design version `creddy-guides-v1`, and
`imageBlockStyle: creddy-abstract-editorial-v1`. Plan exactly 3 assets, including
exactly one hero matching `article.heroVisualId` and the inline/comparison
visuals requested by article blocks. Every asset must use 16:9 so every section
fits the same approved website frame without a layout jump.

Each asset must name its article block, usage, type, aspect ratio, generation
mode, alt text, caption, and accepted claim fields. Use a deliberate mix of
editorial illustration, data visualization, licensed photography, and approved
Creddy product captures. Product captures must be supplied real screenshots;
never generate fake app UI. Licensed photos require provenance.

Find a fresh online photograph for each new website blog hero. Do not select
from a fixed local image library or enumerate past downloads as candidates.
Never submit a brandless composed hero (`generationMode: compose` with no
photo and empty/missing `brandAssetIds`): it renders a repetitive generic globe
or building, not a finished blog cover. If no suitable reviewed image is found,
leave the visual task pending and report the image-selection blocker. This
hero-only rule does not change News imagery or inline/comparison illustrations.
Choose search terms by reader intent, not merely the airline/hotel name: relevant
destinations, cabin interiors, terminal experiences, hotel rooms/pools, or dining.
Write two visual angles before searching: what the reader could experience, and
a useful human moment or practical detail. Natural travelers/guests are welcome;
never imply endorsement of Creddy or a named brand. Prefer Pexels for general
travel experiences when configured and Commons for specific matching subjects.
Run `npm run creddy:editorial-images -- search-pexels "<focused query>"` for at
most six candidates. Missing credentials/provider failure means continue with
Commons and report the setup blocker, not scrape around the API.
Limit a story to three queries total and six promising candidates across providers.
Inspect the actual image and its file-description page, creator, license, exact
subject and any warnings. Search-engine thumbnails and publisher images are not
reuse permission. Reject uncertain authorship, disputed rights, synthetic-looking
photos, unrelated imagery or images that imply an unsupported benefit.
Commons supports explicit CC0, CC BY 4.0 and CC BY-SA 4.0. Pexels uses its own
Pexels license, never Creative Commons. Unknown/NC/ND rights fail closed.
For the chosen image, write one selection JSON with `storyId` (canonical ID),
`sourcePageUrl` (HTTPS Commons File: page), `subject` (exact, <=170 characters),
and `usageNotes` (why relevant, what it does NOT imply, rights-review context).
Run `npm run creddy:editorial-images -- import-online <selection.json>`. This
fetches authoritative metadata and image bytes, verifies supported license,
host, size and integrity, and returns an `online-...` photoAssetId plus a durable
selection receipt. Inspect the downloaded image before accepting the visual plan.
Use that ID with `generationMode: compose`, `assetType: licensed_photo`, hero only;
preserve returned `photoCredit` and exact subject. Agent06 crops/hosts the chosen
image through the existing path. The receipt is for this story's audit/retry,
not a library. On retry reuse the accepted ID; never silently choose a new image.
For Pexels use its exact photo-page URL in `sourcePageUrl` and run
`npm run creddy:editorial-images -- import-pexels <selection.json>` instead.
It re-fetches authoritative metadata by photo ID and validates the original.
Either provider accepts optional `focalPoint: { "x": 0.5, "y": 0.35 }`, using
reviewed normalized coordinates after EXIF orientation. Inspect the 1600x900
render and 320px thumbnail; do not crop away the subject to fill the frame.
Before publishing Pexels, deploy the companion website license/credit support.
Articles must visibly link "Photo by [creator] on Pexels" to the photo page.
Cards stay credit-free; sharing retains the existing attribution-safe fallback.
First inspect `publishedBlogCovers`: the latest 20 actually published blog heroes,
including archive image refreshes. Avoid their source URLs when another
equally relevant reviewed option exists. If status is unavailable, use the local
hints below and say that published history was unavailable; do not assume no
photo has been used or block the queue. Missing source URLs mean unknown imagery.
Compare canonical Commons File: identities (decode escapes, spaces/underscores,
ignore query/fragment); different IDs must not disguise the same photograph.
Filter candidates for truthful subject and relevance first, then recent exact
reuse and neighboring subject repetition. Vary the search angle and choose among
equally suitable unused results. Keep the accepted choice fixed on retries. Reuse is allowed
when there is no equally relevant alternative; the 20-story window is not a quota.
Use `recentBlogCovers` (up to 12 accepted selections, not publication receipts)
and choices already made in this batch to prefer a different photograph AND
subject where an equally relevant reviewed alternative exists. Mix destinations,
terminals, relevant cabins, hotel settings, dining and authentic brand/card art;
do not turn airline coverage into a wall of aircraft exteriors or replace it
with a wall of beaches. Relevance beats variety; there is no quota.
Generic travel photography may illustrate broad rewards/travel decisions even
without the named brand. Preserve its exact subject and illustrative caption.
Never suggest a generic beach is a Hilton property, a cabin belongs to Southwest,
or a pictured lounge/seat is included in an offer. Specific product, cabin,
property or destination claims require an accurate matching asset. Do not use
unrelated office or sky photos merely for variety. If no photo fits, use an
inspected restrained editorial fallback, not an automatic logo-only hero.
Exact product art remains appropriate for product-specific stories.
Keep each accepted cover stable on retries;
never randomize on page load or change existing covers merely to rotate them.
This policy applies only to website blog heroes, not News or social.
Choose one exact `photoAssetId`, `generationMode: compose`, `assetType: licensed_photo`,
and `usage: hero`; omit `brandAssetIds`. Read its exact subject and usage notes.
A brand mention is not enough to select a particular property, cabin or aircraft.
Do not imply current award availability, amenities or eligibility from an archive
photograph. Agent 06 crops the reviewed source, preserves its credit/license,
and includes those links in the public blog. Do not use these photos for inline
or comparison slots in this rollout, and do not repeat the hero three times.
Use exact approved card art for card stories when available; never invent it.
If no reviewed photograph fits, use the existing restrained flat composition
with `brandAssetIds: []`, only after inspecting its relevance and thumbnail quality.
If that fallback is bland or unhelpful, retain a safe existing image or leave the
image task retryable. Do not manufacture a collage or generate logos.
News retains its independent brand-image path; photographs are not automatically
selected for News, where required public photo credits are not yet supported.

For non-photo visuals, use authentic brand-led editorial composition, not generated 3D art.
`agent-5-prepare` lists the reviewed `editorialBrands` registry. For brands
explicitly discussed in that image's section, set `generationMode: compose`,
`assetType: editorial_illustration`, and `brandAssetIds` to up to four exact
registry IDs. Include source attribution in `provenance`. Never substitute a
specific card for a different card or infer a transfer partnership from a logo.
Agent 06 places those exact source pixels without recoloring or redrawing.
Use `brandAssetIds: []` for a restrained flat topic illustration when no suitable
reviewed asset exists. News imagery is independent and never waits for a blog.
Use a recognizable hero, a distinct section illustration, and a useful
comparison composition; do not repeat the same bitmap three times. Keep logos
and important subjects readable at 320px thumbnail width. For supplied photos,
record reuse permission; a publisher's scraped image URL is not permission.

Generated visuals are an exceptional unbranded fallback, not the default.
Use natural editorial photography or restrained flat 2D illustration, never
glossy 3D models, toy planes, floating coins, fake logos, or artificial card art.
Use specific composition, believable materials and lighting, restrained
Creddy cream/gold/coral palette, natural imperfections, and useful negative
space. Exclude text, logos, watermarks, bank-card designs, fake screenshots,
public figures, distorted anatomy, duplicate objects, plastic skin, oversaturated
lighting, and stock-photo poses. Never bake headlines into generated images;
the website renders type in HTML. Visual truth and provenance matter more than
appearing photographic.

Before writing individual prompts, define one 60–500 character `seriesStyle` for
the article. Copy that exact same `seriesStyle` into every generated asset. It
must lock the shared medium, palette, lighting direction, camera/lens or
illustration perspective, material treatment, texture, contrast, and visual
density. Individual `prompt` values then change only the section-specific
subject and composition. The hero establishes the visual language; inline and
comparison images must unmistakably belong to that same editorial series.
Do not mix photography, 3D rendering, collage, flat illustration, or unrelated
color treatments within one article unless the plan explicitly uses supplied
licensed/product assets rather than generated images.

The approved website image block is presentation, not part of the generated
bitmap. Keep the important subject inside the central 78% safe area. Do not ask
the image generator to draw the surrounding cream gallery mat, abstract coin
cluster, dotted travel route, card outline, starburst, border, caption, or any
text. Agent 06 and the website renderer add the exact responsive block around
every hero and inline image automatically; ornaments are hidden below 1100px.
