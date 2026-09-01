# Copy-paste prompt for Codex on the boss Mac

Paste the complete prompt below into a new Codex task on the Mac that already
runs the Creddy article/slideshow automation.

---

You are setting up the standalone Creddy App News Agent beside the existing
Creddy article, slideshow and social-media workflow.

Your objective is to install PR 31 from
`https://github.com/sagar2305/social-media-automation/pull/31`, configure its
News-only runtime using the existing authorized local credentials, run all
preflight checks, and complete one controlled News cycle. Work autonomously
until the controlled cycle is verified or a genuine secret/permission decision
requires my input.

Safety and scope:

1. First inspect the repository, current branch, worktrees and dirty files.
   Preserve every existing change. Do not reset, clean, stash, overwrite or
   delete unrelated work.
2. Do not merge the PR. Fetch it into an isolated worktree if it is not already
   merged into `main`. If it is merged, update the existing checkout safely.
3. Read `docs/CREDDY-NEWS-BOSS-MAC-HANDOFF.md` and
   `scripts/creddy-news/NEWS_AGENT.md` completely before configuring or running
   anything.
4. Use only the standalone `npm run creddy:news -- ...` commands for News.
   Never run `creddy:pipeline`, Agent 4-8, website publication, article creation,
   slideshow rendering, Video Factory, Blotato, or social-media delivery.
5. Keep the News data root different from the existing Creddy content data root.
   Use an absolute path under this Mac user's Documents directory, such as
   `Documents/Creddy/news-agent-data`. Never point it at the existing `/creddy`
   pipeline folder.
6. Preserve `.env.local` and all existing secret values. Add or update only the
   News configuration keys. Never print, echo, commit, paste into chat, or expose
   API keys, service-role keys, signing secrets, bot tokens or app tokens.
7. Configure these non-secret values:
   - `CREDDY_NEWS_AGENT_ENABLED=true`
   - `CREDDY_NEWS_ENABLED=true`
   - `CREDDY_NEWS_DATA_ROOT=<absolute News-only path>`
   - `CREDDY_NEWS_SLACK_CHANNEL_ID=C0BRRM1P1GE`
   - `CREDDY_NEWS_SLACK_TEAM_ID=T1YLH3CH5`
8. Reuse the already authorized local `FIRECRAWL_API_KEY`,
   `CREDDY_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SLACK_BOT_TOKEN`,
   `SLACK_SIGNING_SECRET`, and `SLACK_APP_TOKEN` without revealing them. Reuse
   the approved human `CREDDY_NEWS_SLACK_EDITOR_IDS` if configured. If a required
   secret or editor allowlist is genuinely missing, stop before collection or
   publication and ask me for that exact missing value through our secure
   secret-sharing process.
9. Keep notifications in the existing `#social-media-update` channel. The Slack
   app must have only one Socket Mode consumer. If the existing Creddy Slack
   worker is healthy, reuse it; do not start a duplicate worker.
10. Do not create a public tunnel or public dashboard URL. Localhost is enough.
11. Do not enable or create a recurring schedule during this task. First finish
    and verify one controlled manual cycle.

Setup and verification:

1. Install dependencies using the repository lockfile.
2. Run `npm run creddy:news:test`.
3. Run the existing Creddy test suite and root TypeScript check to prove the
   article/slideshow/social workflow remains unchanged.
4. Run `npm run creddy:news -- init` and
   `npm run creddy:news -- status`. Confirm the output says
   `workflow: creddy-app-news`, uses the News-only root and is enabled.
5. Follow `scripts/creddy-news/NEWS_AGENT.md` to complete one full cycle:
   collection from the configured finance sources, relevance filtering,
   deduplication, independent ranking, bounded official verification, and
   publication of only eligible stories.
6. Do not force a publication. Items missing confirmation, outside freshness,
   conflicting, expired or missing image rights must remain `not_published`.
7. Verify every newly published item in the Supabase public News snapshot, the
   localhost News dashboard and its Slack notification receipt. Confirm the
   mobile feed payload includes it. If no approved image is available, verify
   `image_url` is null so iOS and Android use the branded fallback illustration.
8. Do not click a destructive Slack delete action merely for testing. Report
   whether the Edit news and Delete from app buttons are present for authorized
   editors. Perform a live edit/delete only if I explicitly request it after the
   cycle.
9. Rerun the scoped News publisher once to verify idempotency: no duplicate app
   item and no duplicate Slack message.

Final report:

- State the checked-out commit and PR.
- Report News tests, existing workflow tests and TypeScript results.
- Report collection source count and any source-specific failures.
- Report ranked, officially verified, published, withheld and failed counts.
- List each newly published headline, app record ID, revision and Slack receipt
  without exposing credentials.
- Confirm that the existing article, slideshow and social queues were not read,
  modified, published or scheduled.
- Confirm no recurring schedule was created.
- Provide the exact safe next step for scheduling the standalone News Agent only
  after I approve the manual result.

---
