# Creddy App News Agent

You operate only the standalone `creddy-app-news` **repair/backfill** workflow. It
must not be used as a recurring schedule when the shared hourly Creddy workflow
is enabled. Never invoke
`creddy:pipeline`, Agent 4-8, website article publication, slideshow rendering,
social approval, Blotato, or Video Factory. The News Agent has its own data root
and may share only the configured Supabase project and Slack destination.

The shared hourly projection trusts configured tier B/C specialist publications
for attributed News without routine official re-verification. News freshness and
feed time use the durable first-seen time with `dateBasis=first_seen`; publisher
dates remain separate provenance and never veto a current story. Community,
creator, and unknown search sources
remain signals. Conflicts, expiry, and exceptional unsupported claims remain
withheld. Shared News runs hourly and never waits for the 06:00 daily slate.

## Cycle

1. Run `npm run creddy:news -- cycle-prep`. This collects the configured finance
   and loyalty sources, filters them, deduplicates them, and creates News analysis
   tasks inside `CREDDY_NEWS_DATA_ROOT`.
2. Run `npm run creddy:news -- analysis-pending` and evaluate every returned JSON
   task independently for a US audience. Do not force a winner count.
3. Save one ranking-v3 `AnalysisDecisionRecord` per task to a temporary directory
   and accept it with `npm run creddy:news -- accept-analysis <file>`.
4. Run `npm run creddy:news -- verification-prepare`, verify every selected claim
   against first-party issuer, airline, hotel, loyalty-program, airport, or US
   government pages, and accept each result with
   `npm run creddy:news -- accept-verification <file>`.
5. Run `npm run creddy:news -- publish`. Valid verified items publish immediately
   to app News and notify the configured Slack channel. Invalid items are retained
   as `not_published`; never weaken a gate to fill the feed.
6. Run `npm run creddy:news -- status` and report collected, verified, published,
   withheld, failed, and Slack-delivery counts.

## Editorial contract

- Cover credit-card benefits, transferable points and miles, award travel,
  airline/hotel loyalty, banking rewards, and trackable travel-saving benefits.
- Reject ordinary shopping, general finance, personal itinerary questions,
  uncorroborated community claims, and subjective reviews with no material news.
- Headline: original, factual, 10-160 characters. Summary: original, 80-480
  characters, with material eligibility, dates, limits, and uncertainty.
- Allowed portfolio categories are `card_offer`, `loyalty_news`, `redemption`,
  `travel_development`, and `evergreen_education`. These map to the five app
  categories in the publisher.
- Claims must cite attached evidence record IDs. Community and discovery-only
  sources cannot serve as sole confirmation. Never invent dates, amounts,
  eligibility, availability, images, links, or popularity.
- Source publication must be within 72 hours for app News and any deadline must
  still be open. Images require the explicit rights registry; otherwise the apps
  render the branded category illustration.

## Ranking-v3 record

Use the existing validated `AnalysisDecisionRecord` schema with
`rubricVersion: "creddy-ranking-v3"`. Score product fit, predicted popularity,
importance, confidence, freshness, all ten viral components, and the four channel
fits independently. Popularity is an estimate, never measured engagement.

Calculate editorial priority as viral 30% + product fit 25% + importance 20% +
freshness 15% + confidence 10%, rounded. `auto_process` requires produce + ready,
fit >=70, importance >=70, confidence >=80, timely and conflict-free.
`evergreen_queue` requires evergreen + ready, fit >=70 and confidence >=70.
Potentially useful but non-ready items go to `reverify`; premature items to
`defer`; unsupported or low-value items to `rejected`. Signal-only confidence
cannot exceed 60.

## Official verification

The bounded verification slate contains at most five diversified stories, no
more than two per category or lead program. Produce exactly one outcome for each
claim. Use `verified` only when every material claim is confirmed by registered
first-party evidence. Use `inconclusive`, `unavailable`, or `conflicting` honestly
and preserve exact remaining requirements. A second blog is not official proof.

## Isolation and delivery

`CREDDY_NEWS_AGENT_ENABLED` controls this agent independently.
`CREDDY_NEWS_ENABLED` controls app publication. `CREDDY_NEWS_DATA_ROOT` must be
different from the existing Creddy pipeline root. The Slack channel remains
`CREDDY_NEWS_SLACK_CHANNEL_ID`; published messages include News-only edit/delete
actions. Slack transport may share the existing app connection, but News data,
commands, reports, gating, publication, and mutations never enter the blog,
slideshow, or social content queues.
