# Creddy app News

## Controlled publication verified, recurring cycle not activated

On 2026-08-31, one source-verified U.S. Bank/Avianca story was published through
the News branch and delivered to `#social-media-update`. The public snapshot
returned HTTP 200 with the story; Slack returned receipt `1788184144.786179`.
The production News schema is deployed. Recurring collection, Slack editor
permissions, and end-to-end edit/delete delivery remain unverified or inactive.

Published notifications do not require editor permissions. With no editors
configured, the notification has no edit/delete buttons and Slack mutations
remain denied. Pass canonical IDs after `app-news-publish` to limit a controlled
run to specific stories; without IDs it processes the accepted analysis queue.

App News is an independent output of the existing Creddy content cycle. Agent 7
now calls the news branch using durable Agent 1-3 evidence. It does not recollect
sources, generate article artwork, render social media, change website article
publishing, or bypass slideshow approval. The standalone retry command is
`npm run creddy:pipeline -- app-news-publish`.

The branch is off unless `CREDDY_NEWS_ENABLED=true`. Do not enable it simply to
inspect the dashboard. No production migration, Slack post, live extraction, or
schedule activation is performed by the implementation tests.

## Data and eligibility

Apply the additive migration `20260831140000_creddy_app_news.sql` from the Creddy
mobile/website repository to the same Creddy Supabase project the apps use.
The dashboard staff-auth project remains separate; do not replace its credentials.

- `creddy_news_items`: private content, provenance, state, revision and Slack receipt.
- `creddy_news_audit`: private operator and pipeline history.
- `creddy_news_feed`: public published display fields only.
- `creddy_news_feed_revision`: public invalidation counter for Realtime.
- `creddy_news_snapshot()`: consistent published snapshot for both mobile apps.

Only accepted ranking-v3, verification-ready, conflict-free stories with high
confidence and confirmation evidence for every claim can publish. Source dates
must be within 72 hours and deadlines cannot already be expired. The optional
`newsBrief` on Agent 3 decisions contains original headline/summary/category.
The fallback is the accepted decision headline and summary, never scraped prose.
Headlines are 10-160 characters; summaries are 80-480. Invalid content is recorded
as `not_published` with a reason, not sent to a human approval queue.

News identity is based on the canonical record plus a unique normalized source
URL. Published records and manual edits are not overwritten by cycles. Deleted
records are retained as tombstones; neither the same canonical ID nor the same
URL can be re-imported. Operator edits use optimistic revisions, preventing a
stale Slack modal or dashboard form from overwriting a newer action.

## Images

An extracted image URL does not establish reuse permission. Without approved
rights, News uses the app's branded fallback. An optional operator-maintained
JSON registry at `CREDDY_NEWS_IMAGE_RIGHTS_REGISTRY_PATH` maps normalized article
URLs to `{ "url": "https://...", "rights": "licensed", "attribution": "..." }`.
Allowed rights values are `licensed`, `owned`, and `publisher_permission`.
Do not populate this registry from untrusted scraped image-license claims.
No generated images or additional image-provider credits are used by News.

## Slack and dashboard configuration

Configure these on both the cycle/Socket Mode worker and dashboard server:

```dotenv
CREDDY_NEWS_ENABLED=false
CREDDY_NEWS_SLACK_CHANNEL_ID=
CREDDY_NEWS_SLACK_TEAM_ID=
CREDDY_NEWS_SLACK_EDITOR_IDS=
```

The editor value is a comma-separated allowlist of Slack user IDs, not display
names. Existing protected `CREDDY_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are reused. Socket Mode additionally
uses `SLACK_APP_TOKEN`. No credential belongs in an app bundle or public variable.
Invite the bot to the selected channel and confirm interactive messages/modals
work using either the existing Socket Mode worker or signed HTTP action endpoint.
Do not run two independent action consumers for the same Slack app.

Published notifications have Edit news and Delete from app actions. Edit opens a
Slack modal for headline, summary and category; source identity and image rights
cannot be changed through the modal. Deleting an ordinary Slack message does not
delete app content. All mutations check workspace, channel, editor allowlist and
signed content/revision metadata. HTTP uses Slack request-signature verification.
Callbacks acknowledge before slow writes; notification failures remain retryable.
A successful app mutation stays successful even if Slack's message refresh fails.
Concurrent notification sends use a database lease and durable message receipt;
an uncertain initial send is retried with a stable client message ID. Check Slack
for duplicates if a request was accepted but its receipt was lost.

`/creddy/news` is the staff News manager with Published, Not published and Deleted
states. Staff viewers can read; editors/admins can edit/delete or retry Slack.
It refreshes every five seconds, paginates 100 items, and filters the current page.
Deleted records remain visible for audit and are not hard-deleted.

## Mobile rollout

After backend and channel staging verification, build both apps with
`CREDDY_NEWS_LIVE_ENABLED=true` (iOS build setting / Android Gradle or local property).
False/unset retains the Debug UI preview and keeps Release News entry points hidden.
iOS `--news-preview` explicitly selects fixtures in Debug, even in a live build.
Live mode never silently falls back to fictional content when the service fails.

Both apps use the same public snapshot, subscribe to the revision row while
foregrounded, refresh on foreground entry, and poll every 15 seconds to recover
from a missed/disconnected realtime event. Configure the revision table in the
Supabase Realtime publication; the migration adds it if that publication exists.
Edits/deletes normally propagate as soon as the realtime event and fetch complete,
not a guaranteed zero-latency SLA. Offline/background clients update on reconnect.
Failed live fetches show an error instead of retaining possibly withdrawn content.
Saved readers retain membership for local unsaves, but resolve content from the
current server snapshot, so edits and withdrawals affect open saved stories too.
Bookmarks stay device-local and use separate live/preview namespaces. No account
save synchronization or guest migration is implemented in this milestone.

## Required staging checks before activation

Local verification on 2026-08-31: 207 pipeline tests passed (12 News tests), root
and dashboard TypeScript checks passed, and the dashboard production build passed.
The isolated PostgreSQL migration/test passed publish, edit, stale-write rejection,
delete, no-resurrection, notification-lease, audit, and anonymous-access checks.
Mobile verification passed 15 iOS News unit tests plus the fast-swipe UI test,
247 Android unit tests and 9 Android News UI tests (including edit/withdrawal).
These are not claims of production Slack or Realtime delivery verification.

1. Apply the migration to a staging Creddy database, with anon/authenticated read
   and service-role-only mutation verified by the SQL test in the mobile repo.
2. Run a controlled verified news record through the branch; inspect provenance,
   published feed row, Slack receipt and dashboard status.
3. Use an allowed editor to edit/delete from Slack while both apps are open.
   Verify Explore, Saved news and open saved readers update. Repeat via dashboard.
4. Try a stale form and an unauthorized Slack user. Neither may mutate content.
5. Rerun the cycle: no duplicate publication, no edit overwrite, no resurrection.
6. Disconnect/reconnect each app. Verify fallback refresh and error behavior.
7. Confirm existing website and slideshow workflows remain unchanged, then enable
   News in the already-selected cycle. Do not activate a new independent scraper.
