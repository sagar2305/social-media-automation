# Creddy website article design and single-pipeline contract

## Purpose

Creddy website articles are not a second pipeline. One Agent 03 opportunity keeps
the same canonical ID through Agent 04 copy, Agent 05 visuals, Agent 06
production, Agent 07 review, and Agent 08 destination export. The existing
slideshow and video fields remain compatible.

## Live-site reference

The `creddy-guides-v1` design mirrors the public `getcreddy.com` Guides language:

- background `#FBFAF7`;
- primary text `#1E1A16` and muted text `#7E7976`;
- gold `#D2992E`, coral `#FF605D`, and cream `#FBF2DD` accents;
- Fraunces/Georgia editorial headings and Geist/system body copy;
- 18px rounded cards, restrained borders, generous vertical rhythm;
- `/guides/<slug>` public routes;
- advertiser disclosure plus App Store and Google Play actions.

The article uses a fluid desktop canvas with small responsive page gutters. The
desktop hero uses a 44–76px responsive serif headline and 22px dek. Body copy is
19px with a 1.7 line height. Mobile uses 16px page gutters and collapses referral,
subscription, and download cards to one column.

## Article anatomy

1. Existing Creddy navigation.
2. Guide breadcrumb, category, reading time, headline, and dek.
3. Visible advertiser disclosure.
4. Hero editorial visual.
5. Key takeaways.
6. Plain-English article sections with callouts, tables, and inline visuals.
7. Optional referral cards resolved only through an approved registry.
8. FAQ when it materially helps the reader.
9. Email subscription card with explicit consent.
10. Creddy download card with official iOS and Android URLs.
11. Sources, last-updated date, author, and existing site footer.

## Agent ownership

- Agent 04 writes `creddy-copy-v3`: the complete structured article and social
  formats in one `ContentDraftRecord`.
- Agent 05 adds `creddy-article-visuals-v1` to the same `VisualPlanRecord`.
- Agent 06 creates one production package, validates the article, and writes a
  private themed HTML preview. Missing article assets set `needs_assets` without
  duplicating or blocking valid social outputs.
- Agent 07 presents the article on the existing Content Bank item. Website
  approval is independent from social approval but keeps the same stable ID.
- Agent 08 exports only human-approved, asset-complete articles with resolved
  referral IDs. The live getcreddy.com connector remains disabled until a real
  publishing API or website repository is provided and staging is reviewed.

## Visual standard

Use 3–8 article visuals: one 16:9 hero and useful inline/comparison assets. Prefer
a deliberate mix of real licensed photography, deterministic data graphics,
approved Creddy product captures, and restrained editorial illustration. Use
one coordinated generated-image series per article. Every pending generated
asset carries the exact same `seriesStyle`, locking medium, palette, lighting,
perspective, materials, texture, contrast, and density; its individual prompt
changes only the section-specific subject and composition. This makes the hero
and inline images feel intentionally art-directed rather than independently
generated.

Generated art must avoid generic AI advertising cues: no fake card designs,
logos, invented app screens, baked-in text, distorted anatomy, duplicated
objects, plastic skin, implausible lighting, public figures, or fake documentary
moments. Headline type belongs in HTML. Every asset records alt text, caption,
claim fields, path, and provenance.

Every new Agent 05 visual plan sets
`imageBlockStyle: creddy-abstract-editorial-v1`; all article assets use 16:9.
The renderer—not the bitmap generator—adds the approved block to every visual:
a compact 900px image inside a cream gallery mat with an abstract coin cluster,
dotted travel route, card outline, and starburst in the surrounding desktop
space. The decorations are visual-only and disappear below 1100px. Image prompts
keep the subject inside the central 78% safe area and must not bake the frame,
ornaments, caption, or typography into the image. Agent 08 exports this exact
presentation contract with the approved article payload.

## Referral and subscription safety

Agent 04 stores referral registry IDs, never arbitrary destination URLs. Agent 08
fails closed when an active ID is missing. The disclosure is exact and visible.

The article's Subscribe block means editorial email consent; it is distinct from
the paid `Subscribe now` pricing action on the current homepage. The eventual
public form must verify addresses, deduplicate subscribers, record consent source
and timestamp, and support unsubscribe before production email collection begins.

## Review gates

An article cannot be exported until all of these pass:

- Agent 03 claim and source identity preserved;
- 650–3500 useful words, at least two H2 sections, and required content blocks;
- exact advertiser disclosure and official download URLs;
- every visual has an approved absolute asset path and provenance;
- every referral ID resolves to an active registry entry;
- private desktop/mobile preview reviewed by a human;
- article-specific approval recorded with actor and timestamp.
