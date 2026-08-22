# Creddy Mac mini production deployment

This deployment keeps reviewed code in Git, durable automation data outside
Git, and secrets in a password manager. It uses a named Cloudflare Tunnel with
a stable hostname. Never use a `trycloudflare.com` quick-tunnel URL for Slack
buttons: that hostname expires and breaks existing review messages.

## What belongs where

### Git and the pull request

- Application and dashboard source code.
- Pipeline scripts, tests, schema, and safe setup templates.
- Documentation and non-secret configuration examples.
- Approved reusable visual assets only when their license permits repository
  storage. Use Git LFS or the secure data transfer for large/licensed assets.

### Secure data transfer

- The complete `Social media automation data/creddy` directory.
- Raw articles, manifests, checkpoints, renders, Content Bank records, reports,
  retry evidence, and approved licensed assets that cannot live in Git.
- Use an encrypted disk image or an organization-approved encrypted file share.
  Transfer the decryption password by a separate approved channel.

### Password manager

- Root `.env.local` and `dashboard/.env.local` values.
- Slack bot token, Slack signing secret, webhooks, Cloudflare tunnel credentials,
  Firecrawl, Blotato, Supabase, and every other API credential.
- Share a password-manager vault/item with the boss. Do not send an `.env` file,
  token, signing secret, tunnel credential, or password through Slack or Git.

## One-time Cloudflare setup

Prerequisites: the organization controls a domain in Cloudflare and the Mac mini
has `cloudflared` installed.

1. Sign in locally on the Mac mini:

   ```bash
   cloudflared tunnel login
   ```

2. Create one named tunnel:

   ```bash
   cloudflared tunnel create creddy-dashboard-production
   ```

3. Copy `deploy/macos/cloudflared-creddy-config.yml.example` to
   `~/.cloudflared/config.yml`. Replace the username, tunnel UUID, credentials
   path, and hostname. The final ingress must map the stable hostname to
   `http://127.0.0.1:3000` and end with the `http_status:404` catch-all.

4. Create the DNS route once:

   ```bash
   cloudflared tunnel route dns creddy-dashboard-production creddy.YOUR_DOMAIN
   ```

5. Validate and install the tunnel as the signed-in Mac user:

   ```bash
   cloudflared tunnel ingress validate
   cloudflared service install
   ```

The named hostname remains stable across tunnel and Mac restarts. The tunnel
credentials JSON under `~/.cloudflared` is secret and must have local-only
permissions.

## Dashboard service

1. Clone the reviewed merge commit into
   `$HOME/Code/social-media-automation`.
2. Copy `deploy/macos/com.creddy.dashboard.plist.example` to
   `$HOME/Library/LaunchAgents/com.creddy.dashboard.plist` and replace the Mac
   username/path placeholders.
3. Build before loading the service:

   ```bash
   npm ci
   npm --prefix dashboard ci
   npm --prefix dashboard run build
   plutil -lint "$HOME/Library/LaunchAgents/com.creddy.dashboard.plist"
   launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.creddy.dashboard.plist"
   ```

Do not install this launch agent until its exact plist has been reviewed on the
target Mac. The service listens only on `127.0.0.1:3000`; Cloudflare Tunnel is
the public ingress.

## Environment and Slack configuration

Populate both ignored environment files locally from the password manager.
They must contain the same values for:

- `DASHBOARD_BASE_URL=https://creddy.YOUR_DOMAIN`
- `BLOTATO_API_KEY`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_SOCIAL_UPDATES_CHANNEL_ID`

Keep `CREDDY_DATA_ROOT` pointed at the transferred durable data directory. Never
put a path, query, fragment, localhost URL, raw IP, or `trycloudflare.com` URL in
`DASHBOARD_BASE_URL`.

In the Slack app dashboard, enable **Interactivity & Shortcuts** and set the
Request URL to:

```text
https://creddy.YOUR_DOMAIN/api/creddy/slack/actions
```

Slack must receive HTTP 200 from this endpoint within three seconds. The route
verifies Slack signatures before accepting approval/rejection actions.

## Mandatory verification

Run these after both services are active:

```bash
npm run creddy:validate
npm run creddy:test
npm run creddy:deploy:validate -- --live
npm --prefix dashboard run lint
npm --prefix dashboard run build
```

The deployment validator checks that both environment files agree, required
Slack and Blotato values exist without printing them, the hostname is stable
public HTTPS, and the exact Slack action route is healthy both locally and
through the public tunnel.

The Creddy portal performs a read-only Blotato reconciliation when its pages are
open and every 30 seconds while the tab is visible. A manual move from Scheduled
to Drafts in Blotato is therefore reflected as `Blotato Draft` in the portal;
the local schedule is not treated as authoritative after remote reconciliation.

Before activation, post one test review item, approve it from Slack, and verify
that it changes only to `approved`. It must not schedule or publish until a human
selects destinations and a future schedule in the portal.

## Updating the Mac mini from Git

Deploy only a reviewed merge commit or release tag. Do not deploy a dirty
working tree. A normal update is:

```bash
git fetch origin
git switch --detach REVIEWED_COMMIT_SHA
npm ci
npm --prefix dashboard ci
npm --prefix dashboard run build
npm run creddy:deploy:validate
launchctl kickstart -k "gui/$(id -u)/com.creddy.dashboard"
```

Restarting the dashboard does not change the named tunnel hostname, so existing
Slack Approve/Reject callbacks and portal links remain valid.
