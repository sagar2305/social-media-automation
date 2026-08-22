# Creddy Ingestion Foundation

**Status:** implemented locally, not migrated, not enabled
**Migration:** `dashboard/migrations/add_creddy_ingestion_foundation.sql`

## Purpose

This slice provides the durable boundary between Firecrawl discovery and later
OpenAI analysis. It does not call Firecrawl, OpenAI, Slack, Video Factory, or
Blotato automatically. The existing Social Automation cycle remains unchanged.

## Data flow

```text
creddy_sources
  -> creddy_fetch_runs
      -> creddy_raw_articles
          -> creddy_article_evidence
              -> creddy_canonical_articles
                  -> creddy_review_cases (rare exception only)
```

| Table | Responsibility |
|---|---|
| `creddy_sources` | Campaign-scoped source configuration and health |
| `creddy_fetch_runs` | Idempotent crawl/search attempts, counts, cursors, errors, and credits |
| `creddy_raw_articles` | Immutable-by-convention source snapshots with normalized URL and SHA-256 content identity |
| `creddy_canonical_articles` | One deduplicated real-world event with extraction, scores, verification, route, and rejection evidence |
| `creddy_article_evidence` | Many-to-many provenance between source snapshots and canonical events |
| `creddy_review_cases` | Rare material-conflict decisions and Slack message identity |

All relationships include `campaign_id` constraints where data could otherwise
cross a project boundary. The database therefore rejects a Creddy evidence link
to a MinuteWise or Roast AI record even if application filtering is wrong.

## Incremental identity rules

`scripts/creddy/article-identity.ts` applies cheap deterministic checks before
semantic analysis:

1. Accept only HTTP(S) URLs without embedded credentials.
2. Normalize to HTTPS, lowercase the host, remove `www`, fragments, duplicate
   slashes, trailing slashes, and known analytics parameters.
3. Preserve unknown query parameters because they may choose different content.
4. Sort retained query parameters to create a stable canonical URL.
5. Hash normalized extracted Markdown with SHA-256.
6. Fingerprint normalized titles as an exact-title prefilter.

The resulting behavior is:

| URL | Content hash | Result |
|---|---|---|
| Not stored | Any | `new_url` |
| Stored | Same | `unchanged`; record seen state, skip AI |
| Stored | Different | `content_changed`; create a source version and reverify |

Different URLs that describe the same story are intentionally not merged by
these rules. They move to semantic clustering later, where material differences
such as bonus amount, expiry, targeting, or eligibility can be compared safely.

## Security

- Tables are private: anonymous database access is revoked.
- RLS is enabled on all six tables.
- Authenticated dashboard access is restricted to administrators.
- The worker writes with the Social Automation `SUPABASE_SERVICE_ROLE_KEY`.
- That service-role key is server-only and must never use `NEXT_PUBLIC_`.
- The Creddy product database continues to use only its optional read-only anon
  credentials. No Creddy service-role credential is required or permitted.
- A database check prevents the `slack_review` route unless a material conflict
  changes the message and automated verification has been exhausted.

## Activation procedure

Do not enable the feature yet. The safe order is:

1. Review and apply the migration to the Social Automation Supabase project.
2. Add the server-only Social Supabase service-role credential locally.
3. Run a schema/RLS smoke test using non-production sample records.
4. Implement the repository and dry-run discovery runner.
5. Run the project-scoped Codex Scheduled Task for seven days in shadow mode
   with publishing disabled. This uses Codex/ChatGPT plan usage rather than an
   OpenAI API key, and remains subject to account usage limits.
6. Approve measured thresholds and only then set
   `CREDDY_PIPELINE_ENABLED=true` on the supervised worker.

Applying the schema does not start crawling and does not alter existing
campaign, scheduling, generation, analytics, or publishing jobs.

Before any live call, `npm run creddy:plan` prints all thirteen enabled listing
operations, four topic searches, and the seventeen-request baseline. It performs no
network requests and consumes no Firecrawl credits. Newly discovered article
URLs are additional requests only after same-site filtering and stored-identity
deduplication.

## Rollback and retention

The migration includes an explicit rollback order, but dropping these tables is
data-destructive and requires an export first. Raw rows should not be updated in
normal operation. A later retention job may archive/delete old raw snapshots
under a documented campaign retention policy while retaining canonical event
provenance required for published content.
