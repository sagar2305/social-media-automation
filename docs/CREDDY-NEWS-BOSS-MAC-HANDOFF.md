# Creddy News Agent — Boss Mac handoff

For a single autonomous Codex setup task, copy the prompt from
[CREDDY-NEWS-CODEX-SETUP-PROMPT.md](./CREDDY-NEWS-CODEX-SETUP-PROMPT.md).

This guide installs and runs only Creddy App News. It does not run the blog,
slideshow, website-article, video, Blotato, or social-media agents.

## 1. Check out the News-only PR

```bash
git clone https://github.com/sagar2305/social-media-automation.git
cd social-media-automation
gh pr checkout 31
npm ci
```

After PR 31 is merged, use the repository's `main` branch instead of checking
out the PR.

## 2. Configure secrets locally

Create `.env.local` on the boss Mac through the team's secure secret-sharing
method. Never paste token or service-role values into Slack, GitHub, a commit,
or a screen recording.

Required names:

```dotenv
CREDDY_NEWS_AGENT_ENABLED=true
CREDDY_NEWS_ENABLED=true
CREDDY_NEWS_DATA_ROOT=/Users/REPLACE_ME/Documents/Creddy/news-agent-data

FIRECRAWL_API_KEY=
CREDDY_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

CREDDY_NEWS_SLACK_CHANNEL_ID=C0BRRM1P1GE
CREDDY_NEWS_SLACK_TEAM_ID=T1YLH3CH5
CREDDY_NEWS_SLACK_EDITOR_IDS=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=
```

`CREDDY_NEWS_SLACK_EDITOR_IDS` is a comma-separated list of approved human
Slack member IDs. Do not add the bot ID. The channel remains
`#social-media-update` (`C0BRRM1P1GE`).

`CREDDY_NEWS_DATA_ROOT` must be an absolute, News-only path. The CLI refuses to
use the existing blog/social pipeline directory.

## 3. Safe preflight

These commands do not collect or publish news:

```bash
npm run creddy:news:test
npm run creddy:news -- init
npm run creddy:news -- status
```

Confirm the output says `workflow: creddy-app-news`, shows the expected
News-only root, and reports `enabled: true`.

## 4. Run the News Agent in Codex

Open this repository in Codex on the boss Mac and start a separate task using
this exact prompt:

> Read `scripts/creddy-news/NEWS_AGENT.md` completely and run one complete
> standalone Creddy App News cycle. Use only `npm run creddy:news` commands and
> the configured News data root. Do not run `creddy:pipeline`, blog, slideshow,
> website article, video, Blotato, or social-media agents. Publish only stories
> that pass every evidence, official verification, freshness, conflict, and
> image-rights gate. Send News notifications to the already configured Slack
> channel. Report collected, verified, published, withheld, failed, and Slack
> delivery counts with the local report paths.

The agent performs:

```text
18 sources
  -> collect
  -> finance relevance filter
  -> deduplicate
  -> rank
  -> official verification
  -> publish eligible stories to Supabase
  -> iOS / Android / dashboard realtime feed
  -> same Slack channel notification
```

Stories that do not pass all publication gates remain `not_published` and do
not appear in the app.

## 5. Slack edit and delete actions

The Slack app needs one Socket Mode consumer. If the existing Creddy Slack
worker is already running on the boss Mac, do not start a second copy. Otherwise:

```bash
npm run creddy:slack:socket
```

Published News messages contain `Edit news` and `Delete from app`. Authorized
actions update Supabase; iOS, Android, and the dashboard receive the changed
snapshot through Realtime and fallback refresh.

## 6. Manual diagnostics

```bash
npm run creddy:news -- status
npm run creddy:news -- analysis-pending
npm run creddy:news -- verification-pending
```

Do not run `publish` manually against incomplete tasks. Let the News Agent finish
ranking and official verification first.

## 7. Scheduling

First complete one controlled manual cycle and verify its app row, dashboard row,
Slack receipt, and Slack edit/delete behavior. Create a separate Codex schedule
for the exact prompt in section 4 only after explicit approval. Do not add News
to the existing blog/social scheduled task.
