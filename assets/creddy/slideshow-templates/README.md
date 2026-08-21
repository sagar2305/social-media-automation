# Creddy reusable slideshow templates

These are pre-rendered, text-free Creddy scenes for deterministic slideshow
production. Normal slideshow runs select a template from `phone-screens/manifest.json`
and add copy with Pillow; they do not regenerate the mascot, podium, background,
phone or app screen.

Locked rules:

- Canvas: 1080 x 1440 px (3:4).
- Layout: Creddy on the left, phone on the right.
- Theme: black, cream and gold with the warm spotlight.
- The gold character behind Creddy must be an open letter C.
- Main headline: `fonts/tungsten-condensed-bold.ttf`.
- Cream supporting-card copy: `fonts/DIN-Condensed-Bold.ttf`.
- The typography pairing above is approval-locked. Do not replace the
  supporting-card font with Druk or an AI approximation.
- Keep positive headline line spacing; text lines must never touch or overlap.
- Show and approve a full-size proof before producing or publishing a new set.
- Never add slide counters such as 1/6 or 2/6.
- Only create a new background asset when a new approved app screen or mascot
  pose is required. Copy-only changes reuse these files.

Current reusable phone-screen scenes:

- Wallet / Vouchers
- Spend Goals
- App Store listing (dark)
- App Store listing (light)

Reusable expression scenes are stored in
`../slideshow-expressions-1080x1440/`. All 20 are native 1080 x 1440 bases,
created from the approved expression artwork with proportional cropping only.
Do not stretch or directly use the older 941 x 1672 source renders in a 3:4
slideshow.
