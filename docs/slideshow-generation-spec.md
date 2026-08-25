# Slideshow Post Generation — Portable Spec

How this repo generates a 6-slide TikTok photo post from nothing. Written to be
handed to another project/agent that needs to reproduce the same output.

Every Creddy slideshow post contains exactly **6 slides**. This is a hard
validation rule for the 3:4 workflow; a five-slide or seven-slide plan must be
corrected before rendering begins.

Source of truth: `scripts/text_overlay.ts`, `scripts/generate_images.ts`,
`scripts/overlay-text.py`.

---

## The one architectural rule

**Images are generated with NO text on them. Text is burned on afterwards with
PIL.**

Every image prompt below ends with an explicit "no text, no words, no letters"
instruction. This is not a style preference — image models render typography
badly (misspellings, broken kerning, garbled letterforms). Generating a clean
background and compositing real text over it is the only way to get sharp,
correctly-spelled, consistently-positioned copy.

If you take one thing from this document, take that.

```
Step 1  Gemini (text)   → slide copy as JSON        (no images yet)
Step 2  Gemini (image)  → one clean image per slide (no text on them)
Step 3  PIL / Pillow    → burn the copy onto each image
Step 4  Last slide      → pre-made CTA image, swapped in verbatim
```

---

## Output shape

| Property | Value |
|---|---|
| Slides per post | **6** (5 content + 1 CTA) |
| Canvas | **1080 × 1440** (3:4 portrait) |
| Text zone | Top **6% → 65%** of the frame |
| Text style | White, bold italic, black stroke + drop shadow |
| Last slide | Pre-made app-store CTA image |

The 65% limit exists because TikTok's own UI (caption, username, action rail)
covers the bottom third of the screen. Anything below that line gets hidden.

---

## Creddy locked design system

Creddy uses its own deterministic design system instead of the generic white
italic text treatment above. This is the approved baseline for every Creddy
slideshow asset.

| Property | Locked value |
|---|---|
| Canvas | **1080 × 1440 px (3:4)** |
| Headline font | **Tungsten Condensed Bold** |
| Supporting-card font | **DIN Condensed Bold** |
| Palette | Black, warm cream and Creddy gold |
| Character | Approved Creddy expression asset with the correct open gold **C** |
| Environment | Black/cream background, warm spotlight and podium |
| Text method | Deterministic Pillow composition; never AI-generated lettering |
| Slide counters | Never render `1/6`, `2/6`, etc. inside the image |

Typography is approval-locked: the large headline must use the repository's
`tungsten-condensed-bold.ttf`, while copy inside the cream supporting card must
use `DIN-Condensed-Bold.ttf`. **Do not substitute Druk or another condensed
font for the supporting card.** Font changes require a new visual proof and
explicit user approval before any complete slideshow is rendered.

Before delivery, visually verify at least one character slide and one phone
slide at full size. Reject the render if adjacent headline lines touch or
overlap, supporting copy overflows, the callout has unintended empty space, or
either locked font was not loaded from the repository asset files.

### Mandatory variety and product-proof rules

These are release gates, not optional art direction:

- The approved expression library contains 20 reusable poses: `neutral`,
  `waving`, `thinking`, `confused`, `idea`, `worried`, `surprised`, `sleepy`,
  `sad`, `wink`, `card`, `thumbs-up`, `guide`, `rewards`, `celebrate`,
  `curious`, `skeptical`, `pointing`, `happy`, and `urgent`.
- Slides 1–5 must contain five distinct, script-appropriate character
  expressions. Adjacent slides may never repeat the same expression.
- Batch selection must balance usage across all 100 v4 expressions. Reusing one
  generic pose throughout different posts is a failed render.
- Slide 6 must use one approved real Creddy phone-screen template. Select among
  `wallet_vouchers`, `spend_goals`, `app_store_dark`, and `app_store_light`
  according to the story and CTA.
- Slide 6 is a protected product-proof composition. No supporting card,
  caption box, badge, or other overlay may cover Creddy or the phone. Only the
  safe headline region is composited; the CTA remains in the post caption and
  deep link. An obscured mascot or phone is a failed render.
- A batch fails before Content Bank handoff if any post lacks six slides, lacks
  expression diversity, repeats adjacent expressions, omits the phone-screen
  proof slide, uses an unapproved pose, or changes the locked typography/theme.
- Agent 06 also validates the complete scheduled batch: the visible slides must
  cover `min(20, post_count × 5)` distinct approved expressions and slide 6 must
  cover `min(4, post_count)` distinct approved phone templates. A repetitive
  batch exits unsuccessfully and is not eligible for Agent 07 portal handoff.
- Agent 07 independently revalidates every manifest, file, font path, text
  layout, expression asset and phone proof. A failed gate must return the item
  to Agent 06 for regeneration; it can never be silently uploaded.
- Copy-only changes reuse the approved raster templates; they do not spend
  image-generation credits or reinterpret the mascot.

The locked character-only reference is the 1080 × 1440 composition containing
the top gold rail/starburst, oversized mixed-case headline, cream supporting
card, Creddy on the podium and no bottom icon rail.

### Creddy template families

1. **Character story template** — the approved Creddy expression stands on the
   podium; only the expression, headline and supporting-card copy change.
2. **Real app screen template** — the same theme, typography, character and
   podium are retained, but a phone mockup is added and its display contains a
   real screenshot captured from the Creddy simulator.

Both families must look like one campaign. Do not introduce a different color
grade, font, phone style, mascot style or background treatment between them.

---

## Creddy real app screen template plan

The purpose of this template is to connect each content claim to real product
proof. The phone UI must never be invented by an image model. It is captured
from the working Creddy app and composited into a reusable phone frame.

### Phase 1 — Capture approved simulator screens

1. Open the real Creddy app in the iOS simulator.
2. Use one fixed simulator device, scale, appearance and status-bar state for
   the complete screenshot library.
3. Sign in with a safe demo account containing representative data and no
   personal or production customer information.
4. Navigate to each approved product screen and capture a lossless PNG.
5. Store the untouched captures under:
   `assets/creddy/app-screens/raw/<screen-slug>.png`.
6. Store a sanitized/crop-ready version under:
   `assets/creddy/app-screens/approved/<screen-slug>.png`.
7. Record the app build, simulator device, capture date and screen purpose in a
   small manifest so screenshots can be refreshed when the app UI changes.

Initial screen library:

- Home/product dashboard
- Cards and benefits overview
- Benefit detail
- Alerts or reset reminders
- Best-card/recommendation screen
- Rewards or usage progress
- Settings/profile only when the script needs it

The exact list is finalized after the real app is opened and its available
screens are reviewed. Only screens that exist in the app are used.

### Phase 2 — Build the reusable phone composition

Create a transparent phone-frame asset with an exact display mask. At render
time the selected approved screenshot is resized with aspect-fill/fit as
required, clipped to the display mask, and placed behind the frame. The phone
frame, reflections and screenshot perspective remain deterministic.

Locked composition rules:

- **1080 × 1440 px (3:4)** final canvas.
- Same Creddy black/cream/gold theme and warm spotlight.
- Same Tungsten headline and DIN supporting copy.
- Creddy remains on or visually connected to the podium.
- Phone may sit beside Creddy, but it must not cover the face, hands or open
  gold **C** silhouette.
- Real screenshot remains readable at mobile size.
- Keep important content away from Instagram/TikTok right-side controls and
  bottom caption/navigation overlays.
- No fabricated app text, fake statistics or generated UI.
- Do not place private account information, email addresses, card numbers or
  notification contents in the exported post.

### Phase 3 — Connect scripts to screens

Agent 05 selects the best approved app screen and Creddy expression using the
script's intent. Examples:

| Script intent | Product screen | Creddy expression |
|---|---|---|
| Unused benefits | Benefits overview | Surprised or worried |
| Expiring credit | Benefit detail/reset alert | Thinking or urgent |
| Best card for a purchase | Recommendation screen | Pointing or confident |
| Progress/value tracked | Rewards progress | Celebrating or thumbs-up |
| Product walkthrough | Home/dashboard | Presenting |

The visual plan must include `screen_slug`, `expression_slug`, headline,
supporting copy and phone placement. Agent 06 then composites the real screen,
phone frame, chosen expression and deterministic text. It does not regenerate
the app UI.

### Phase 4 — Template outputs and review

Each approved template render must provide:

- Final 1080 × 1440 PNG
- Source screenshot slug and capture manifest reference
- Creddy expression slug
- Headline and supporting-card copy
- Safe-zone validation result
- A visual review confirming the screenshot is readable, the character is not
  obstructed and no platform controls will cover the primary message

The first phone-screen template is reviewed manually and becomes the locked
master. Future slides reuse that master and only change the approved screenshot,
copy and expression.

### Approved reusable phone-screen library

The production-ready rendered scenes live in
`assets/creddy/slideshow-templates/phone-screens/` and are indexed by its
`manifest.json`. The locked phone-screen layout is **Creddy on the left and the
phone on the right**. Routine slideshow generation selects one of these scenes
and burns copy onto it; it must not regenerate the scene.

The exact bundled font files are:

- `assets/creddy/slideshow-templates/fonts/tungsten-condensed-bold.ttf`
- `assets/creddy/slideshow-templates/fonts/DIN-Condensed-Bold.ttf`

This reuse path is mandatory for copy-only revisions because it preserves brand
consistency and avoids unnecessary image-generation usage.

---

## Step 1 — Slide copy

One Gemini call returns the whole post as JSON. Model: `gemini-2.5-flash` with
`responseMimeType: "application/json"`.

### The prompt

```text
You are a TikTok content creator generating a slideshow post for the {CAMPAIGN} campaign.

{BRAND_LINE}          e.g. "The brand is MinuteWise, an AI note-taker for students."
{STYLE_LINE}          e.g. "Visual style: photorealistic, cinematic."
{TONE_LINE}           e.g. "Tone: friendly, peer-to-peer, never corporate."

ACCOUNT: {ACCOUNT_NAME} ({HANDLE})

HOOK STYLE: {HOOK_STYLE}
{HOOK_INSTRUCTION}

TRENDING TOPICS (pick one or blend):
{TRENDING_SNIPPET}     — first ~500 chars of your trend research

WINNING FORMATS:
{WINNER_SNIPPET}       — first ~400 chars of what's performed best so far

SLIDE STRUCTURE RULES:
- Generate exactly 8 slides
- Slide 1 = Hook (pattern interrupt, grab attention)
- Slides 2-3 = Problem (relatable struggle the audience faces)
- Slides 4-6 = Tips/Solution (one actionable gold nugget per slide)
- Slide 7 = Resolution (transformation, proof it works)
- Mention {BRAND} naturally in exactly one slide, as the solution to a pain
  point already raised earlier — never as an ad
- Keep text concise — designed for TikTok slideshow (viewers swipe quickly)
- Each line should be punchy, 5-15 words max
- Stay strictly within this campaign's topic and audience
- Do NOT repeat content from previous posts

CAPTION RULES:
- Also write a "caption" — the TikTok post description (NOT slide text).
- 2-4 punchy sentences, roughly 250-350 characters, on-brand for this campaign.
- Expand the hook into real value: tease what the slides deliver, then end with
  a soft CTA (e.g. "Save this", "Follow for more", "Try it tonight").
- Do NOT include any hashtags in the caption — they are appended separately.

OUTPUT FORMAT (strict JSON, no markdown):
{
  "title": "The hook title for this post (this becomes the caption hook)",
  "caption": "2-4 sentence TikTok description that expands the hook, no hashtags",
  "slides": [
    { "top": "short header", "center": "main point 1-2 sentences", "bottom": "supporting line" },
    { "top": "...", "center": "...", "bottom": "..." }
  ]
}

Generate a unique, engaging post now.
```

### Why it asks for 8 but you ship 6

Over-generating gives you slack. The first 5 usable slides become content, the
6th is the CTA. Extras are dropped. If Gemini returns fewer than 5, retry —
don't ship a short post.

### Hook styles (rotate these — it's a live A/B test)

| Style | Instruction |
|---|---|
| `question` | Start slide 1 with a compelling question that makes viewers curious. |
| `bold_claim` | Start slide 1 with a provocative, bold statement that challenges beliefs. |
| `story_opener` | Start slide 1 with a personal narrative like "I wish I knew..." or "The day I discovered..." |
| `stat_lead` | Start slide 1 with a surprising statistic or data point. |
| `contrast` | Start slide 1 with a "Stop doing X, do Y instead" contrast. |

Tag every post with the hook style used, then rank by save rate later. That's
the entire optimisation loop.

### Validate before continuing

Retry (up to 3×) if any of these fail — Gemini returns truncated JSON often
enough that this matters:

- `title` present
- `slides` is an array of **≥ 5**
- every slide has string `top`, `center`, `bottom`

### Assign a role to each slide

Roles drive the image prompt's facial expression, so they must be assigned
before image generation:

| Position | Role |
|---|---|
| Slide 1 | `hook` |
| Slide 2 | `knowledge_gap` |
| Any slide whose text mentions the brand | `brand_mention` |
| Everything else | `value` |
| Slide 6 | `cta` |

---

## Step 2 — Slide images

One image call per slide. Three interchangeable visual flows — pick one per
post and stay in it for all slides.

### Shared rules (all flows)

These are what make six separate generations look like one post:

1. **Same character in every slide** — same face, hair, skin tone, outfit,
   accessories. State it twice in the prompt; models drift otherwise.
2. **Same location, lighting and colour grade** across all slides.
3. **No text anywhere.**
4. **Leave the upper 60–70% clear** for the overlay.
5. **3:4 portrait.**
6. Tell the model which slide it is: *"This is slide 3 of 6 — ALL slides must
   look like they belong together."*

### Expression per role

Vary only the expression between slides — everything else stays locked.

| Role | Photorealistic | Animated |
|---|---|---|
| `hook` | looking directly at camera with a confident smirk | excited and energetic, pointing at viewer |
| `knowledge_gap` | surprised, eyebrows raised, mouth slightly open | curious, head tilted, thinking pose |
| `brand_mention` | smiling while looking at phone screen | happily holding up a phone showing an app |
| `value` | focused and determined | engaged and expressive |
| `emotional` | genuinely happy, slight smile, relaxed | proud, confident pose, thumbs up |
| `cta` | warm friendly smile, holding a phone showing the app | same |

### Flow A — Photorealistic

```text
Create a photorealistic, cinematic image for a TikTok slideshow background.
This is slide {N} of {TOTAL} — ALL slides must look like they belong together.

SCENE: {CHARACTER}, {EXPRESSION}, {SCENE}.

CHARACTER (must be IDENTICAL in every slide): {CHARACTER}
— Same face, same hair, same skin tone, same outfit, same accessories in EVERY
  slide. No variation allowed.

IMPORTANT: Do NOT include any text, words, letters, or typography on the image.
This is a clean background — text will be added separately.

Style rules:
- Photorealistic, cinematic quality — shot on Arri Alexa or Sony A7
- Character must be the SAME PERSON in every slide — same face, same features,
  same clothing
- Same location, same lighting setup, same color grading across all slides
- Cinematic color grading — warm golden or cool moody tones (consistent throughout)
- Modern, aesthetic, Instagram-worthy composition
- Shallow depth of field for professional look
- Leave upper 60-70% of image for text overlay (TikTok safe zone)
- NO text, NO words, NO letters, NO typography anywhere
- NO cartoon, NO illustration, NO 3D render — pure photorealistic
- 3:4 aspect ratio (portrait, taller than wide) for mobile viewing
```

### Flow B — Animated

Identical structure, but a rotating animation style replaces the photographic
direction. **Use a different style for every post, the same style within a
post.**

```text
Create an animated image in {ANIM_STYLE} for a TikTok slideshow background.
This is slide {N} of {TOTAL} — ALL slides must look like they belong together.

SCENE: {CHARACTER}, {EXPRESSION}, {SCENE}.

CHARACTER (must be IDENTICAL in every slide): {CHARACTER}
— Same face shape, same eye color, same hairstyle, same outfit, same
  accessories in EVERY slide.

ANIMATION STYLE (must be IDENTICAL in every slide): {ANIM_STYLE}
— Same rendering technique, same line weight, same color treatment, same
  lighting style in EVERY slide.

IMPORTANT: Do NOT include any text, words, letters, or typography on the image.
This is a clean background — text will be added separately.

Style rules:
- {ANIM_STYLE} — fully commit to this EXACT animation style, no variation
- Character must be PIXEL-PERFECT CONSISTENT across all slides
- Same background environment and color temperature across all slides
- Warm, colorful, visually engaging
- Leave upper 60-70% of image for text overlay (TikTok safe zone)
- NO text, NO words, NO letters, NO typography anywhere
- NOT photorealistic — fully animated/illustrated
- 3:4 aspect ratio (portrait, taller than wide) for mobile viewing
```

### Flow C — Emoji overlay

Flow B's images, plus a semi-transparent emoji reaction bubble composited into
the top-right corner of each slide, mapped to the narrative beat:

| Beat | Slides | Emoji |
|---|---|---|
| Hook | 1 | 🤔 |
| Problem | 2–3 | 😰 |
| Tips | 4–6 | 💡 |
| Resolution | 7 | 🔥 |
| CTA | 8 | 👉 |

### Animation style pool

Rotate through these so consecutive posts never look alike:

Pixar 3D · Stop Motion (claymation) · Kurzgesagt Flat · 90s Cartoon ·
Watercolor · Paper Cutout · Retro Pixel Art · Anime/Manga · Chalk/Blackboard ·
Storybook · Pop Art · Minimalist Line Art · Neon/Cyberpunk · Sketch/Pencil ·
Isometric · Collage Art · Gouache Paint · Retro 70s

Each needs a full sentence, not a label. Example:

> `Stop motion claymation style like Wallace & Gromit, puppet-like characters, tactile clay textures, handcrafted sets`

### Character pool

Pick one per post, describe it identically in all six prompts.

**Photoreal:** *"A young woman with curly brown hair, warm brown skin, wearing a
cozy cream knit sweater and gold hoop earrings"* · *"A young man with short fade
haircut, dark skin, wearing a navy blue hoodie and wireless earbuds"* · *"A young
Asian woman with straight black hair in a ponytail, wearing an oversized sage
green cardigan and round glasses"*

**Animated:** *"A girl with big expressive eyes, short bob haircut with bangs,
wearing a yellow hoodie and jeans"* · *"A boy with messy curly hair, big round
glasses, wearing a green jacket and sneakers"*

The level of detail is the point. "A student" drifts wildly between slides; this
doesn't.

---

## Step 3 — Burn the text on

Pillow, not the image model.

```python
TARGET_WIDTH, TARGET_HEIGHT = 1080, 1440    # 3:4, enforced by resize + crop

FONT = "Helvetica Neue Bold Italic"          # same face on every slide
FONT_SIZE_TITLE = 80                         # hook / first line
FONT_SIZE_BODY  = 56
FONT_SIZE_SMALL = 46                         # long lines

TEXT_COLOR    = (255, 255, 255)
STROKE_COLOR  = (0, 0, 0)
STROKE_WIDTH  = 5
SHADOW_OFFSET = (4, 4)
SHADOW_COLOR  = (0, 0, 0, 180)

LINE_SPACING        = 18
GAP_BETWEEN_BLOCKS  = 24
MAX_TEXT_WIDTH      = 0.85   # of canvas width
TEXT_TOP            = 0.06   # start 6% down
TEXT_BOTTOM_LIMIT   = 0.65   # never cross 65%
```

Auto-shrink the font until all three blocks (`top`, `center`, `bottom`) fit
inside the safe zone. Never let text spill past 65% — shrink instead.

The heavy black stroke plus drop shadow is what keeps white text readable over
an unpredictable AI-generated background. Don't skip either.

---

## Step 4 — CTA slide

The final slide is **not generated**. It's a fixed, pre-made image — the app
store card — dropped in verbatim. Generating it each time produces a different
logo every post, which reads as fake.

Keep one PNG per campaign and composite it as slide 6.

---

## Caption and hashtags

The caption Gemini wrote is used as-is, then hashtags are appended.

**20 hashtags in four tiers:**

| Tier | Count | What |
|---|---|---|
| 1 | 5 | Broad trending |
| 2 | 7 | Niche |
| 3 | 5 | Ultra-niche |
| 4 | 3 | Branded / topic |

**Warning from live experience:** if tier 1 is filled automatically from
whatever is globally trending, you will end up stapling celebrity gossip and
breaking-news tags onto unrelated content. Ours attached a murder-trial hashtag
to a study video. Keep a denylist, or restrict tier 1 to tags that are actually
topically related. TikTok reads off-topic tag stuffing as spam.

---

## Things that cost us time

- **Compress before upload.** Full-size slide PNGs (~3MB each) intermittently
  failed conversion at the posting API. JPEG q85 fixed it.
- **Archive every generated post to disk** before posting. When a post fails you
  can re-send the same slides instead of paying for regeneration.
- **Spell-check the copy** before overlay. Run a pass of known brand-name
  misspellings — the model gets its own brand name wrong.
- **Reset the "used templates" set per run**, or several accounts get near-
  identical posts in the same cycle.
- **Text placement beats image quality.** A mediocre background with sharp,
  well-placed copy outperforms a beautiful background with text crammed to the
  edge.
