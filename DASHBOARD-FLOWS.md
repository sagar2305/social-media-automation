# Dashboard — Complete Interaction Flows

How every major action works end-to-end: what you click, what the system does, what changes in the database, and what you see as a result.

**System layers used throughout:**
- **Dashboard** — the Next.js web app (browser)
- **Supabase** — the cloud database (shared between dashboard and Mac)
- **Mac** — the local machine running the automation pipeline (TypeScript scripts)
- **Blotato** — external API that submits posts to TikTok
- **TikTok** — the final destination
- **ScrapeCreators** — external API that fetches view/like/save counts

---

## FLOW 1 — "Run Cycle Now" (Manual Trigger)

*When you want to post right now without waiting for the scheduled time.*

```
STEP 1 — You click "Run Cycle Now" on the Runs page
         ↓
         Dashboard opens the form panel

STEP 2 — You fill in the form:
         • Choose flow(s): Photorealistic / Animated / Emoji Overlay
         • Choose accounts (or leave blank for all active)
         • Choose posting path: Draft or Direct Post
         • Set posts per account (default: 1)
         • Toggle "Skip research" if you want to skip Virlo trend fetch
         ↓
         All selections stored locally in the browser (not saved yet)

STEP 3 — You click "Submit Job"
         ↓
         Dashboard → Supabase:
         INSERT into cycle_jobs table:
           {
             flows: ["animated"],
             path: "direct",
             account_handles: ["yournotetaker"],
             posts_per_account: 1,
             skip_research: false,
             status: "pending",
             requested_at: now
           }
         ↓
         Supabase: Row created. Status = "pending"
         ↓
         Dashboard: Form closes. Green banner appears:
         "Queued — waiting for Mac to pick up (≤60s)"

STEP 4 — (Within 60 seconds, automatically)
         Mac runs cycle_jobs_poller.ts every 60 seconds
         ↓
         Mac → Supabase: SELECT from cycle_jobs WHERE status = "pending"
         ↓
         Mac finds the new job row
         ↓
         Mac → Supabase: UPDATE cycle_jobs SET status = "claimed"
         (This is atomic — prevents two Mac processes from running the same job)
         ↓
         Dashboard banner updates to: "Running on the Mac…"

STEP 5 — Mac starts the actual cycle (npm run cycle with the job's flags)
         ↓
         Mac → Supabase: INSERT into cycle_runs:
           {
             status: "running",
             flows: ["animated"],
             accounts: ["yournotetaker"],
             path: "direct",
             posts_total: 1,
             posts_done: 0,
             current_phase: "Research"
           }
         ↓
         Dashboard Live Runs page: Run appears in the list with a pulsing green "LIVE" badge
         (auto-refreshes every 4 seconds)

STEP 6 — Cycle runs through its phases (each phase logs an event):

         Phase 1: Trend Research (if skip_research = false)
           Mac → Virlo API: fetch trending topics
           ↓
           Mac writes fresh trends to data/TRENDING-NOW.md
           ↓
           Mac → Supabase: INSERT cycle_events: { kind: "phase_done", label: "Research" }

         Phase 2: Content Generation
           Mac → Gemini API: generate slide text, captions, hashtags
           ↓
           Mac → Gemini API (Imagen): generate slide images (8 images per post)
           ↓
           Mac saves images to local temp folder
           ↓
           Mac → Supabase: INSERT cycle_events: { kind: "post_generated", label: "Slides ready" }

         Phase 3: Posting
           Mac uploads each image → Blotato media API (gets a public URL per image)
           ↓
           Mac → Blotato POST /posts:
             {
               accountId: "cmmxd7lo605mnle0y2xe2o1x6",
               mediaUrls: [...8 image URLs],
               caption: "...",
               isDraft: false,   ← (false = direct post, true = draft)
               autoAddMusic: true
             }
           ↓
           Blotato → TikTok: submits the slideshow
           ↓
           Blotato returns: { postSubmissionId: "abc123xyz" }
           ↓
           Mac appends a row to data/POST-TRACKER.md:
             | abc123xyz | 2026-05-07 | question | study_tips | animated | ... | pending (yournotetaker, animated) | - |
           ↓
           Mac → Supabase: INSERT cycle_events: { kind: "post_submitted", account: "yournotetaker" }
           ↓
           Mac updates: cycle_runs.posts_done += 1

STEP 7 — Cycle finishes
         Mac → Supabase: UPDATE cycle_runs SET status = "completed", ended_at = now
         ↓
         Mac → Supabase: UPDATE cycle_jobs SET status = "completed"
         ↓
         Dashboard: Run card shows green checkmark "COMPLETED"
         Dashboard: "Run Cycle Now" button reappears (active job banner disappears)

STEP 8 — Later: analytics sync updates the post status
         (See FLOW 4 — Analytics Pull for how views/saves get filled in)
```

---

## FLOW 2 — Automatic Scheduled Batch

*How a batch like "Morning-Animated at 08:00" fires without anyone touching the dashboard.*

```
Mac runs scheduler_tick.ts every 5 minutes (controlled by macOS launchd)

Each tick does:

STEP 1 — Mac → Supabase: SELECT from schedule_settings WHERE id = 1
         ↓
         Reads: { enabled: true, timezone: "Asia/Kolkata" }
         ↓
         If enabled = false → exits immediately. Nothing fires.

STEP 2 — Mac converts current UTC time to the configured timezone (IST)
         e.g. 02:30 UTC → 08:00 IST

STEP 3 — Mac → Supabase: SELECT from cycle_batches WHERE enabled = true
         ↓
         Gets all enabled batches, ordered by order_index
         e.g. [
           { label: "Morning-Animated", run_time: "08:00", last_run_date: "2026-05-06", ... }
           { label: "Evening-Photo",    run_time: "19:00", last_run_date: "2026-05-07", ... }
         ]

STEP 4 — For each batch, Mac checks two conditions:
         ✓ Has run_time passed today in the configured timezone?
         ✓ Has last_run_date NOT already been set to today?
         ↓
         If BOTH are true → fire the batch
         If EITHER fails → skip this batch

         Example:
           "Morning-Animated": run_time=08:00, now=08:05 IST, last_run_date=2026-05-06
           → 08:05 > 08:00 ✓ AND last_run=yesterday ✓ → FIRE

           "Evening-Photo": run_time=19:00, now=08:05 IST
           → 08:05 < 19:00 ✗ → SKIP (not time yet)

STEP 5 — BEFORE spawning the cycle, Mac immediately:
         Mac → Supabase: UPDATE cycle_batches SET last_run_date = "2026-05-07"
         (This prevents a second tick 5 minutes later from firing the same batch again)

STEP 6 — Mac spawns "npm run cycle" as a background child process with the batch's flags:
         --flow=2 --path=direct --account=yournotetaker
         ↓
         The cycle runs exactly as described in FLOW 1 Steps 5–7

CATCH-UP RULE: If the Mac was sleeping at 08:00 and wakes up at 08:45, the next tick fires
               the batch immediately (still within the 60-minute catch-up window).
               If the Mac was asleep the entire window (e.g. wakes at 14:00), the batch is
               skipped and retried tomorrow.
```

---

## FLOW 3 — Cancel a Running Cycle

*When you need to stop a cycle that is currently running.*

```
STEP 1 — You click "Cancel running cycle" on the Live Runs page
         ↓
         Browser shows confirmation popup:
         "Cancel this running cycle? Already-submitted posts cannot be unposted..."

STEP 2 — You click "Confirm"
         ↓
         Dashboard → Supabase:
         UPDATE cycle_runs
         SET status = "cancelled", ended_at = now, error_text = "Cancelled by admin"
         WHERE id = [this run's id] AND status = "running"

STEP 3 — Dashboard: Run card immediately shows "CANCELLED"

STEP 4 — On the Mac (within ~5–30 seconds):
         Between each phase, the cycle checks:
         Mac → Supabase: SELECT status FROM cycle_runs WHERE id = [this run]
         ↓
         Sees status = "cancelled"
         ↓
         Mac exits the cycle process cleanly

         NOTE: If a phase is currently mid-execution (e.g. images are being generated),
         it will finish that phase first, then notice the cancellation before starting
         the next phase. Posts already submitted to Blotato CANNOT be undone.
```

---

## FLOW 4 — Analytics Pull (How Views/Saves Get Updated)

*How a post that says "0 views" eventually shows "5,420 views".*

```
This runs automatically as part of "npm run refresh" (daily) or "npm run analytics"

STEP 1 — Mac reads data/POST-TRACKER.md
         Gets all posts that have a Post ID but no TikTok URL yet

STEP 2 — For each such post:
         Mac → Blotato GET /posts/{postSubmissionId}
         ↓
         Blotato returns: { status: "published", publicUrl: "https://tiktok.com/@yournotetaker/photo/..." }
         ↓
         Mac updates POST-TRACKER.md:
           status: "published"
           tiktok_url: "https://tiktok.com/@yournotetaker/photo/..."

         If Blotato returns status = "in-progress":
           Mac updates status to "in-progress" (still processing)

         If Blotato returns status = "failed":
           Mac updates status to "error" + captures the exact error message
           Mac writes the error to Supabase auto_fix_events immediately
           (so the dashboard shows it without waiting for the next sync)

STEP 3 — For each published post, Mac fetches metrics:
         Mac → ScrapeCreators GET /v2/video?url={tiktok_url}
         ↓
         Returns: { views: 5420, likes: 312, saves: 87, shareCount: 14 }
         ↓
         Mac updates POST-TRACKER.md row:
           views: 5420, likes: 312, saves: 87, save_rate: 1.6%

STEP 4 — Mac runs sync-to-supabase.ts:
         Reads the entire updated POST-TRACKER.md
         ↓
         Dashboard → Supabase: UPSERT all rows into "posts" table
         (upsert = insert if new, update if already exists, matched by Post ID)
         ↓
         Dashboard: Posts page now shows the updated view counts.
         Overview KPI cards update.
         Top Performing Content list reorders by new view counts.
```

---

## FLOW 5 — Autoresearch Daily Brain Run

*The AI that decides what to test next. Runs automatically at 08:30 every day.*

```
STEP 1 — Mac runs autoresearch.ts at 08:30 (scheduled via launchd)

STEP 2 — Mac reads the last 14 days of posts from POST-TRACKER.md
         Calculates per account:
         • Average views last 7 days vs. prior 7 days
         • Posts per day rate
         • Hashtag diversity (how different are the hashtag sets?)
         ↓
         Builds an "account health report":
         e.g. "@yournotetaker: avg views CRASHED from 180 → 12 (−93%), posting 3.3/day, hashtag diversity LOW"

STEP 3 — Mac evaluates active experiments (ones older than 24h):
         For each experiment:
         • Fetches views/saves for variant A and B posts
         • Declares winner if one variant is clearly better
         • Records result in data/EXPERIMENT-LOG.md and data/results.tsv

STEP 4 — Mac fetches fresh trends (if not skipping research):
         Mac → Virlo API: get trending topics
         ↓
         Updates data/TRENDING-NOW.md and data/HASHTAG-BANK.md

STEP 5 — Mac builds the full context for Gemini:
         • Account health report (from Step 2)
         • Current experiment results
         • FORMAT-WINNERS.md (which hooks perform best)
         • TRENDING-NOW.md
         ↓
         Mac → Gemini API (gemini-2.5-flash):
           Prompt: "Given this account health, these experiment results, and these trends,
                    what variable should we test next? OR is there a strategy problem
                    that needs fixing first?"
         ↓
         Gemini returns a JSON decision:
           {
             action_type: "experiment",        ← OR "strategy_fix" if something is broken
             variable: "hook_style",
             variant_a: "question",
             variant_b: "bold_claim",
             account: "yournotetaker",
             hypothesis: "Question hooks get more saves in the study-tips niche",
             warnings: [],
             strategy_notes: null
           }

         OR if it detects a problem:
           {
             action_type: "strategy_fix",
             warnings: ["Account posting 3.3x/day — TikTok suppression detected"],
             strategy_notes: "Reduce to 1 post/day. Vary hashtag sets completely."
           }

STEP 6 — Mac → Supabase: INSERT into autoresearch_runs:
         All decision fields including action_type, warnings, strategy_notes
         ↓
         Dashboard Autoresearch page:
         • Polls Supabase every 15 seconds
         • If action_type = "strategy_fix" → shows RED ALERT BANNER with the warnings
         • If action_type = "experiment" → shows green "Today's recommendation" banner
         • New row appears in the decisions list

STEP 7 — Tonight's scheduled batch picks up the decision
         When the next cycle runs, the pipeline reads FORMAT-WINNERS.md
         and the autoresearch decision to decide which hook style to use
```

---

## FLOW 6 — A Failed Post Gets Investigated and Resolved

*When a post shows up in the red "Posts Not Posted" alert on the Overview page.*

```
STEP 1 — You see the amber alert on the Overview page: "2 Posts Not Posted"

STEP 2 — You click a row in the table
         ↓
         Row expands to show:
         • Full Post ID
         • Exact error message from Blotato (e.g. "Please update TikTok app to the latest version")
         • Plain-English "How to fix" explanation
         • All hashtags on that post
         • Related auto-fix events from the same day

STEP 3 — You read the fix hint and take action
         (e.g. you open TikTok on the phone for that account and update the app)

STEP 4 — You click "Copy Post ID"
         ↓
         Post ID copied to clipboard. No server call.
         ↓
         You open my.blotato.com/failed in a new tab
         You paste the Post ID to find this exact submission in Blotato

STEP 5 — Once you've fixed the root cause, you come back and click "Mark Resolved"
         ↓
         Browser shows confirmation: "Mark this post as resolved?"
         ↓
         You confirm
         ↓
         Dashboard → Supabase:
         UPDATE posts
         SET failure_resolved = true,
             failure_resolution_note = "Marked resolved by admin",
             failure_resolved_at = now
         WHERE id = [this post's id]
         ↓
         Post disappears from the amber alert immediately
         ↓
         If this was the only failed post → the entire amber alert section disappears
```

---

## FLOW 7 — Adding a New TikTok Account

*When you want to add a new account to the pipeline.*

```
PRE-REQUISITE: The TikTok account must already be connected to Blotato at my.blotato.com.
               You need the Blotato Account ID (a number like 37043 or a long ID like cmm...).

STEP 1 — Go to Accounts page → click "Add Account"
         ↓
         Inline form appears with 4 fields

STEP 2 — Fill in:
         • Blotato Account ID: the ID from my.blotato.com (e.g. "37048")
         • TikTok Handle: the handle without @ (e.g. "new.account.handle")
         • Display Name: how it shows in the dashboard (auto-fills from handle if blank)
         • Notes: optional internal notes

STEP 3 — Click "Add Account"
         ↓
         Dashboard validates all 3 required fields are filled
         ↓
         Dashboard → Supabase:
         INSERT into accounts:
           { id: "37048", handle: "new.account.handle", name: "@new.account.handle", active: true }
         ↓
         Account appears immediately in the managed accounts table with "ACTIVE" status
         ↓
         From the next scheduler tick, this account is included in all batches
         that target "all active accounts" (i.e. account_handles = [])

STEP 4 — To PAUSE the account (temporarily remove from cycles):
         Click the power icon on that account's row
         ↓
         Dashboard → Supabase: UPDATE accounts SET active = false
         ↓
         Account row turns grey and shows "PAUSED"
         ↓
         Scheduler skips this account until you enable it again

STEP 5 — To PERMANENTLY remove the account:
         Click the trash icon → confirm
         ↓
         Dashboard → Supabase: DELETE from accounts WHERE id = "37048"
         ↓
         Account gone from the table. All historical posts/analytics remain.
```

---

## FLOW 8 — Editing a Scheduled Batch

*When you want to change what time or which flow a batch runs.*

```
STEP 1 — Go to Settings → Schedule → scroll to Cycle Batches

STEP 2 — Click the pencil (edit) icon on the batch you want to change
         ↓
         That row transforms into an editable form inline:
         • Label text field
         • Run time (HH:MM)
         • Flow checkboxes (Flow 1 / Flow 2 / Flow 3, multi-select)
         • Account checkboxes (which accounts, leave empty = all active)
         • Posting path dropdown (Draft / Direct)
         • Posts per account
         • Skip research toggle

STEP 3 — Make your changes
         (All changes are local in the browser until you save)

STEP 4 — Click the checkmark (save) button
         ↓
         Dashboard → Supabase:
         UPDATE cycle_batches
         SET run_time = "20:00", flows = ["photorealistic"], path = "draft", ...
         WHERE id = [this batch's id]
         ↓
         Row exits edit mode and shows the new values
         ↓
         Takes effect within the NEXT 5-minute scheduler tick.
         No restart needed. No SSH to the Mac.

STEP 5 — To cancel without saving: click the X button
         ↓
         Row reverts to the original values. No server call.
```

---

## FLOW 9 — Master Scheduler Toggle (Pause Everything)

*Emergency stop for all scheduled posting.*

```
STEP 1 — Go to Settings → Schedule

STEP 2 — Click the Master Scheduler toggle to OFF
         ↓
         Toggle turns grey locally. Status card shows "Paused".
         (Not saved yet)

STEP 3 — Click "Save Changes"
         ↓
         Dashboard → Supabase:
         UPDATE schedule_settings SET enabled = false WHERE id = 1
         ↓
         Button shows "Saved!" briefly

STEP 4 — On the Mac (within 5 minutes):
         Scheduler tick runs
         ↓
         Mac → Supabase: SELECT enabled FROM schedule_settings
         ↓
         Sees enabled = false
         ↓
         Mac exits immediately. No batches fire.
         ↓
         Stays paused until you flip the toggle back to ON and save again.
```

---

## FLOW 10 — Creating a Share Link (For External Viewers)

*Sharing the dashboard with your manager or a client without giving them login access.*

```
STEP 1 — Go to Settings → Sharing → "Create share link"

STEP 2 — Fill in:
         • Title: e.g. "Performance Report — May 2026"
         • Accounts: click account handles to filter (leave blank = show all accounts)
         • Expires at: optional date (leave blank = link never expires)

STEP 3 — Click "Create share link"
         ↓
         Dashboard → Supabase:
         INSERT into share_links:
           { title: "Performance Report", accounts: ["yournotetaker"], expires_at: "2026-06-01" }
         ↓
         Supabase auto-generates a random token (e.g. "a3f7b2c9d1e8")
         ↓
         New row appears in the Active Links table

STEP 4 — Click the copy icon on the new link
         ↓
         Full URL copied to clipboard:
         "https://your-dashboard.vercel.app/share/a3f7b2c9d1e8"
         ↓
         You send this URL to your manager by email/Slack

STEP 5 — Your manager opens the URL in their browser
         ↓
         NO login required
         ↓
         Dashboard → Supabase: SELECT from share_links WHERE token = "a3f7b2c9d1e8"
         ↓
         Checks: does the link exist? Is it expired?
         ↓
         If valid: shows a simplified view — KPIs (views, likes, saves, followers) + views chart
         Only shows data for the accounts you selected in Step 2
         ↓
         If expired: shows "This link has expired"
         If token not found: shows 404

STEP 6 — To revoke access: click the trash icon on that link row
         ↓
         Dashboard → Supabase: DELETE from share_links
         ↓
         Anyone who visits the old URL now gets a 404 immediately
```

---

## FLOW 11 — Setting Up a Slack/Discord Alert

*Get a message in Slack when any post crosses 10,000 views.*

```
STEP 1 — Go to Settings → Alerts

STEP 2 — Paste your Slack Incoming Webhook URL
         (from api.slack.com → Apps → Incoming Webhooks → "Add to Slack")

STEP 3 — Select type: Slack (or Discord)

STEP 4 — Configure the rule:
         • Metric: Views
         • Condition: Greater than
         • Threshold: 10000
         ↓
         To add more rules: click "+ Add rule"
         (e.g. also alert when Save Rate > 5%)

STEP 5 — Click "Save Alert"
         ↓
         Dashboard → Supabase:
         INSERT into alert_config:
           { type: "slack", webhook_url: "https://hooks.slack.com/...", enabled: true,
             rules: [{ metric: "views", condition: "gt", threshold: 10000 }] }
         ↓
         New alert card appears in Active Configurations

STEP 6 — To pause without deleting: click "Disable" on the card
         ↓
         UPDATE alert_config SET enabled = false
         ↓
         Badge changes from "Active" to "Disabled". Alerts stop firing.

STEP 7 — To delete: click the trash icon
         ↓
         DELETE from alert_config
         ↓
         Card disappears. No more alerts sent to that webhook.
```

---

## FLOW 12 — Login / Logout

```
LOGIN:
STEP 1 — Go to /login, enter email + password, click "Sign in"
         ↓
         Browser → Supabase Auth: POST /auth/v1/token with credentials
         ↓
         If correct: Supabase returns a JWT access token + refresh token
         ↓
         Token stored in a secure HTTP-only cookie
         ↓
         Browser redirects to / (Overview page)
         ↓
         Every page load reads the cookie to identify who you are
         and what role you have (admin / viewer)

         If wrong password: Supabase returns 401
         ↓
         Dashboard shows: "Invalid login credentials" error message

LOGOUT:
STEP 1 — Click your avatar or "Sign out" in the sidebar
         ↓
         Browser → Supabase Auth: POST /auth/v1/logout
         ↓
         Auth cookie cleared
         ↓
         Browser redirected to /login
         ↓
         Any attempt to access a protected page redirects back to /login
```

---

## FLOW 13 — Export CSV

*Available on Overview, Posts, Accounts, Experiments, Formats pages.*

```
STEP 1 — Click "Export CSV"
         ↓
         NO server request is made
         ↓
         Browser takes the data already loaded on the page
         ↓
         JavaScript converts it to CSV format (comma-separated, quoted if needed)
         ↓
         Browser creates a temporary file object (Blob) in memory
         ↓
         Browser triggers an automatic download of e.g. "posts.csv"
         ↓
         File saved to your Downloads folder
         ↓
         Temporary Blob is released from memory

         Note: The exported data is a snapshot of what was on screen at that moment.
         If you have a date filter active, only the filtered data is exported.
         Refreshing the page and then exporting gives you the latest data.
```

---

## Summary — Where Data Lives and Who Writes It

| Data | Written by | Read by |
|---|---|---|
| `cycle_jobs` | Dashboard (Run Now button) | Mac (jobs poller, every 60s) |
| `cycle_runs` + `cycle_events` | Mac (cycle_reporter.ts, live during cycle) | Dashboard (Live Runs page, every 4s) |
| `cycle_batches` | Dashboard (Batch Manager) | Mac (scheduler_tick, every 5 min) |
| `schedule_settings` | Dashboard (Schedule toggle) | Mac (scheduler_tick) |
| `posts` | Mac (sync-to-supabase, via POST-TRACKER.md) | Dashboard (Posts, Overview, Accounts pages) |
| `account_stats` | Mac (sync-to-supabase, via ACCOUNT-STATS.md) | Dashboard (Accounts page) |
| `auto_fix_events` | Mac (api-client.ts, on every API error) | Dashboard (Errors page) |
| `autoresearch_runs` | Mac (autoresearch.ts, daily 08:30) | Dashboard (Autoresearch page, every 15s) |
| `accounts` | Dashboard (Account Manager) | Mac (every cycle, to find active accounts) |
| `share_links` | Dashboard (Sharing settings) | Public /share/[token] page |
| `alert_config` | Dashboard (Alerts settings) | Mac (during analytics, to send webhooks) |
