# Creddy blog SEO audit — 2026-09-01

## Publication audit

The live CMS contained 15 articles. Two were accidental substitutions for the
approved 2026-08-31 five-story slate and were recoverably unpublished:

- `spark-cash-plus-2000-bonus-500-travel-credit`
- `alaska-airlines-paris-athens-routes-seattle`

The remaining 13 articles have valid local content-bank records. The existing
phantom-award guide remains valid: a later Agent 03 rejection applies to a new
duplicate candidate, not to the accepted published guide.

## Portfolio-wide findings

### High priority

1. Six evergreen articles reuse the same generic meta description and nearly
   identical heading framework. Rewrite them around distinct search intent;
   useful specificity matters more than publishing volume.
2. The five current-news articles rely on one secondary source and have
   inconclusive official verification. Keep cautious reported language, add
   first-party evidence when available, and show when volatile facts were last
   checked.
3. A title must match the page. A “comparison” needs an actual comparison table;
   a card-offer article should identify the card, fee, eligibility constraints,
   terms, and timeframe that the evidence supports.

### Technical foundation

Canonical URLs, server-rendered copy, crawlable headings, BlogPosting,
BreadcrumbList, FAQ schema, social images, robots, and sitemap coverage are in
place. The production site is behind the development code that already reads
the CMS publication timestamp. The accompanying website PR adds explicit
Published labels, article-specific Twitter metadata, and related-article links.

## Article-by-article recommendations

### Current points transfer bonus comparison

- Intent: current transfer bonuses and how to compare them.
- Gap: the page promises a comparison but contains no current comparison table.
- Improve: add program, transfer ratio, deadline, targeted/public status, useful
  redemption, official link, and last-checked timestamp. If those facts cannot
  be verified, retitle the page as an evergreen transfer-bonus decision guide.

### Targeted Marriott bonus points and elite credits

- Intent: Marriott targeted promotion eligibility and registration.
- Gap: no concrete offer variants, stay window, or registration window.
- Improve: explain that targeting varies, show supported variants and dates,
  link official account/registration evidence, and include a worked stay-plan
  example without implying universal eligibility.

### Frontier Miles elite-status changes

- Intent: Frontier elite-status changes and 2027 qualification strategy.
- Gap: generic change guidance does not satisfy a reader seeking thresholds.
- Improve: add an official before/after table for earning and tier thresholds,
  effective dates, fare/card effects, and two traveler scenarios.

### Chase elevated business-card offers

- Intent: compare elevated Chase business-card bonuses.
- Gap: the current page does not name the exact cards or supported offer terms.
- Improve: identify each supported card, annual fee, bonus, spend window,
  eligibility caveats, and redemption fit in one table. Avoid centering the
  article on spend requirements alone.

### Bilt Virgin Rent Day transfer bonus

- Intent: Bilt-to-Virgin September Rent Day transfer bonus.
- Gap: the title is specific while the body is mostly a generic transfer guide.
- Improve: add verified tier percentages, eligibility, promotion window, one
  award calculation, transfer timing, and a prominent reported/last-checked
  statement when first-party confirmation remains unavailable.

### Phantom award space before transferring points

- Intent: how to verify phantom award space.
- Strength: distinct evergreen problem, useful checklist, and corroborated
  sources; retain it.
- Improve: add a step-by-step multi-channel verification example, name common
  mixed-cabin and married-segment traps, and link contextually to the transfer
  bonus guide.

### Southwest Rapid Rewards practical guide

- Intent: Southwest points, status, and Companion Pass planning.
- Strength: its headings and description are already distinct.
- Improve: add current first-party thresholds, qualifying/nonqualifying earning,
  two redemption examples, and a dated Companion Pass checklist.

### Marriott Bonvoy Brilliant elite benefits

- Intent: Marriott Brilliant benefits and break-even value.
- Gap: generic metadata and headings make it resemble unrelated guides.
- Improve: create a current benefit table, separate automatic Platinum status
  from elite-night credits, explain authorized-user limits, and show a cautious
  annual-fee break-even calculation using official terms.

### JetBlue TrueBlue practical guide

- Intent: JetBlue points and Mosaic status.
- Gap: generic metadata and outline do not target TrueBlue queries.
- Improve: explain points pricing, Tiles, Mosaic progression, pooling, change and
  cancellation rules, and one cash-versus-points example using official sources.

### American Airlines AAdvantage practical guide

- Intent: AAdvantage miles, Loyalty Points, status, and awards.
- Gap: generic metadata and headings obscure the core distinction.
- Improve: separate redeemable miles from Loyalty Points, explain AA dynamic
  pricing versus partner awards, add a qualification example, and use current
  first-party rules.

### Amex Gold travel-benefits value test

- Intent: Amex Gold benefits and annual-fee value.
- Gap: generic metadata; “travel benefits” is broader than the actual analysis.
- Improve: use an official benefit/enrollment table, show realistic low/base/high
  utilization scenarios, state the annual fee, and separate credits from points
  earning and Hotel Collection benefits.

### Hotel fees before transferring Amex points

- Intent: Amex-to-Leaders Club transfers and hotel fees.
- Gap: the title is too broad and the metadata is generic.
- Improve: name Leaders Club/LHW in the title, add a worked points-plus-fees
  example, explain property-specific taxes/resort fees, and distinguish cash,
  points, and transfer-bonus outcomes.

### Atmos Rewards 2026 practical guide

- Intent: Atmos Rewards program mechanics and 2026 changes.
- Gap: generic metadata and headings; insufficient change chronology.
- Improve: add a dated rollout timeline, earning choices, partner mechanics,
  status progression, card interactions, and clear labels for announced versus
  live features using Alaska's official pages.

## Durable acceptance criteria

- Every card and article page shows a visible `Published` date matching the CMS
  timestamp and BlogPosting/Open Graph metadata.
- Republishing content preserves the first publication timestamp.
- SEO descriptions and H2 outlines are article-specific; generic shared
  templates fail validation.
- Volatile claims use primary evidence where available or explicit reported and
  last-checked treatment.
- The title's promised artifact (comparison, thresholds, offer terms, or guide)
  exists in the body.
- Retained pages have descriptive images and 2–4 relevant internal links.

No Supabase schema migration, cron, or Edge Function is required. Existing
`published_at`, `source_updated_at`, article JSON, and storage assets are enough.
