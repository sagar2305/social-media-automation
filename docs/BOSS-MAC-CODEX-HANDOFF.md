# Boss Mac mini — Codex handoff

Paste the complete prompt below into Codex on the office Mac mini. There are no
placeholders to replace. Codex discovers the Mac username, the separately shared
private env file, and transferred data, then records the exact reviewed commit it
installs. Do not put API-key values in the prompt or in chat.

## Ready-to-paste Codex prompt

```text
Set up the Creddy Social Media Automation system on this office Mac mini.

Work autonomously through every safe, reversible setup and verification step.
Do not stop after giving me instructions. Pause only for an unavoidable account
sign-in, macOS permission, installation approval, missing physical transfer file,
or the final activation/publishing approval. After I handle that one blocker,
continue from the saved checkpoint without restarting completed work.

Approved repository: https://github.com/sagar2305/social-media-automation.git
Approved branch after the Creddy PR is merged: origin/main

Discover the remaining machine-specific values yourself:
- Resolve the exact installation commit from the current origin/main after fetching it. Show me the commit hash and Creddy PR/commit summary before installing it; proceed only after I confirm it is the reviewed version.
- Search the mounted volumes, Downloads, Desktop, and Documents for either an encrypted Creddy .dmg or a directory named "Social media automation data". Do not search system or unrelated user directories. If exactly one candidate is found, use it. If none or more than one is found, ask me to select the correct candidate.
- Search the same approved locations for exactly one regular file named "creddy-boss.env". Never print, summarize, upload, or paste its values. If none or more than one is found, ask me to select the correct file.
- If an encrypted image is found, open it and let macOS ask me for its password. Never ask for, read, store, or display that password in chat.
- Derive the durable destination as "$HOME/Documents/ChatGPT/Social media automation data" for the currently signed-in office Mac user.
- Store the resolved repository, exact commit, source path, and destination path in the final readiness report. Do not modify this handoff document just to substitute paths.

Safety and scope:
1. Do not post, schedule, send a TikTok draft, enable publishing, or contact any mutation endpoint during setup.
2. Never ask me to paste API keys into chat. Install the supplied private env file with mode 600 and verify only variable names and whether required values are non-empty.
3. Do not overwrite an existing non-empty data directory. Inspect all paths before copying.
4. Do not commit .env files, data, generated media, logs, node_modules, or build output.
5. Keep CREDDY_PIPELINE_ENABLED=false until the complete supervised dry run passes.
6. Use exactly one Codex scheduled task for the eight-agent Creddy workflow—never eight separate schedules.
7. Install missing prerequisites only from official sources. Show me the exact Homebrew installer before running it and wait for approval if Homebrew itself is absent. Once Homebrew exists, the reviewed setup script may install Git, Node/npm, Python, and cloudflared automatically.

Perform these steps:
1. Verify macOS, at least 30 GB of free disk space, time zone, sleep settings, Codex desktop sign-in, and repository access. If Homebrew is absent, obtain my approval and install it using only the current command published at https://brew.sh. Do not use a copied third-party installer.
2. Clone the approved repository into "$HOME/Code/social-media-automation" only if that destination does not already exist. If it exists, inspect it and stop rather than overwriting it. Fetch origin, resolve the confirmed origin/main commit, and check out that exact commit in detached state or a clearly named deployment branch. Do not use an unreviewed feature branch.
3. After resolving DATA_SOURCE and DATA_ROOT as described above, run from the repository root:
   bash scripts/setup_creddy_office_mac.sh \
     --env-file "$ENV_FILE" \
     --data-source "$DATA_SOURCE" \
     --data-root "$DATA_ROOT" \
     --install-prerequisites \
     --start-dashboard
4. Confirm the installer created protected root and dashboard .env.local files without displaying their contents. Verify only that required variable names are present and non-empty, with all values redacted. The installer must refuse to replace pre-existing env files.
5. Confirm CREDDY_DATA_ROOT points to the resolved DATA_ROOT, CREDDY_AI_EXECUTION_MODE=codex_scheduled, and CREDDY_PIPELINE_ENABLED=false.
6. Run the configuration validator, Creddy tests, TypeScript checks, targeted lint, and production dashboard build. Fix only setup-specific problems; do not silently change product behavior.
7. Verify the production dashboard responds at http://127.0.0.1:3000/creddy. Render the repository's launchd template with the resolved repository path and user, show me the exact plist, and after I approve it install and load the recoverable dashboard service. Do not install publishing launch jobs.
8. Inspect DASHBOARD_BASE_URL without exposing any secret. Verify that it is a stable HTTPS hostname and not localhost or a temporary trycloudflare.com address. Inspect the named Cloudflare Tunnel configuration. If Cloudflare authentication or DNS ownership is missing, open the official login flow for me; after I authenticate and approve the hostname, create/configure the named tunnel, update only DASHBOARD_BASE_URL in both protected env files, restart the dashboard, and verify the public `/creddy` page plus `/api/creddy/slack/actions` callback route. Never print tunnel credentials.
9. Verify Slack using read-only `auth.test` and channel lookup calls with values loaded locally from the protected env. Confirm the bot identity, configured channel, `chat:write` and `files:write` capability, and callback signing-secret presence without printing credentials. If the bot is not in a public configured channel and has permission to join, ask once for approval and join it; otherwise tell me the exact `/invite @bot-name` action. Send one clearly labeled setup-test message only after I approve that message.
10. Open the Creddy portal and verify that the transferred posts, six-slide images, reports, statuses, Instagram connection, and TikTok connection are visible. Account checks must be read-only.
11. Run a pipeline status/report check and a supervised no-publish dry run. Verify that every agent writes JSON/Markdown evidence locally and that at least five complete posts can reach pending human review when enough eligible unique items exist. Stop before approval or delivery.
12. Show me one final readiness report covering code version, data path, services, account mappings, tests, dashboard URL, public callback, Slack verification, scheduler state, backups, disk space, logs, and every remaining blocker.

Only after I explicitly approve activation, set CREDDY_PIPELINE_ENABLED=true and create exactly one twice-daily Codex scheduled task in the Social Media Automation project. Its workflow must run Agents 1 through 8 sequentially in one task, start each agent only after the previous durable output passes validation, read the matching files under scripts/creddy/prompts before AI-driven stages, retry transient failures with bounded backoff, avoid duplicates using the existing locks/idempotency rules, preserve every JSON/Markdown report, require at least five content-bank posts per successful fetch cycle when at least five eligible unique items exist, and stop at human approval before any external delivery. Agent 8 may reconcile explicitly approved submissions, but publishing must remain human-controlled according to the portal settings. Never create one scheduled task per agent.

The scheduled task must begin with `npm run creddy:validate` and `npm run creddy:test`, then use the Agent 01→08 command descriptions from `docs/CREDDY-SCHEDULED-TASKS.md`. Use that document for stage commands only: if its legacy multi-task schedule topology conflicts with this prompt, this prompt's exactly-one sequential task requirement wins. It must finish with `npm run creddy:pipeline -- report` and a visible summary of every stage, retry, no-op, blocker, output path, Content Bank status, Slack status, and exact next human action. Missing human approval is a safe no-op, not an error.

If the Mac restarts or misses a run, recover from durable state without deleting or regenerating successful outputs. Never claim success unless the portal, reports, tests, and service health all verify it.

Keep the Mac powered on and the ChatGPT/Codex desktop app running for local scheduled tasks. After creating the scheduler, show its name, project, local execution mode, exact local time zone and twice-daily times, next run, ACTIVE/PAUSED state, and confirmation that there is only one matching Creddy automation. Do not create a duplicate if one already exists; update the existing one.
```

## What is shared separately

1. **Git:** reviewed application code only.
2. **Secure file transfer:** the `Social media automation data` directory and
   any licensed assets not stored in Git.
3. **Secure direct transfer:** `creddy-boss.env`, containing Firecrawl,
   Blotato, Supabase, Slack, and other local values. Transfer it with AirDrop,
   an encrypted drive/image, or an approved password manager. Never send it
   through Slack, ordinary email, a Git issue, or a pull request. Delete the
   transfer copy after both protected `.env.local` files are installed.
4. **Codex on the office Mac:** the single scheduled orchestrator after the
   supervised dry run is approved.

## What the Mac setup script does

`scripts/setup_creddy_office_mac.sh` is the repeatable installer and verifier
that Codex runs after it has cloned the reviewed code. It:

1. Confirms the computer is macOS and checks Git, Node, npm, and Python.
2. Copies the transferred data into a new empty destination and refuses to
   overwrite an existing non-empty folder.
3. Installs the separately supplied private env file into protected root and
   dashboard `.env.local` files without printing its values, and refuses to
   overwrite existing env files.
4. Installs the root and dashboard dependencies.
5. Validates the 13-source Creddy configuration.
6. Runs the Creddy test suite.
7. Builds the production dashboard.
8. Prints the remaining activation checklist.

The production dashboard must use the named-tunnel procedure in
`docs/CREDDY_MAC_MINI_DEPLOYMENT.md`. A temporary `trycloudflare.com` hostname is
not an acceptable production URL because existing Slack buttons would break
when it expires.

It intentionally does **not** create the Codex scheduler, enable the pipeline,
start publishing, schedule a post, or send a TikTok draft. Those actions happen
only after the boss reviews the dry-run report and explicitly approves them.
