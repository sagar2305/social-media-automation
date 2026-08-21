# Creddy Slack notifications

Creddy sends lifecycle updates for **Ready for review**, **Scheduled**, **Published**, and **Rejected** posts to `#social-media-update`. The Agent 7 review message includes all six rendered slides, Instagram and TikTok captions, hashtags, and safe **Approve in portal** / **Reject** buttons. Approval never schedules or publishes the post. Slack delivery retries three times and never changes or rolls back the social-post operation.

## Create the Slack app

1. Open <https://api.slack.com/apps> and choose **Create New App**.
2. Choose **Blank app** (not Starter app).
3. Name it `Creddy Social Updates` and select the `SmartApps` workspace.
4. Open **OAuth & Permissions** and add the bot scopes `chat:write` and `files:write`.
5. Install the app to the workspace and copy the **Bot User OAuth Token** (`xoxb-...`). Treat it like a password.
6. Invite the app to `#social-media-update`.
7. Open **Basic Information**, copy the **Signing Secret**, and store it only in the local environment.
8. Open **Interactivity & Shortcuts**, turn it on, and set the Request URL to `https://YOUR-STABLE-DASHBOARD/api/creddy/slack/actions`.
9. Optionally enable **Incoming Webhooks** for the simpler Scheduled/Published/Rejected lifecycle messages.

## Configure the Mac

Add the same secret to both ignored local environment files:

```dotenv
SLACK_SOCIAL_UPDATES_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_SOCIAL_UPDATES_CHANNEL_ID=C0BRRM1P1GE
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
DASHBOARD_BASE_URL=https://creddy.YOUR-DOMAIN
```

- Portal actions read `dashboard/.env.local`.
- Agent 8 reads the repository-root `.env.local`.
- `DASHBOARD_BASE_URL` must be a stable named public HTTPS hostname. Temporary
  `trycloudflare.com` quick tunnels are rejected because they expire and break
  existing Slack buttons.
- Restart the dashboard and scheduled worker after changing environment variables.
- Run `npm run creddy:deploy:validate -- --live` before sending review items.

The six-image review and buttons require the bot token. Slack cannot call
`localhost`; production requires the named tunnel described in
`docs/CREDDY_MAC_MINI_DEPLOYMENT.md`. Quick tunnels may be used only for isolated
development and must never be configured in `DASHBOARD_BASE_URL` or Slack's
production Interactivity Request URL.
