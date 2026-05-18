# Dashboard — Button & Interaction Flow Guide

Every clickable element in the dashboard, what it does when pressed, and what happens in the database or browser as a result.

---

## Overview Page (`/`)

### Date Range Filter (top-right: "7d / 30d / 90d / All")
**Click:** Adds `?range=7d` (or `30d`, `90d`) to the URL.  
**What happens:** The page reloads and re-fetches posts from Supabase filtered to that date window. All KPI cards, the chart, the top posts list, experiments table, and leaderboard all update to show only that date range. If you pick "All", the `range` param is removed and everything shows.  
**Who can use:** Everyone.

### Export CSV (top-right, with download icon)
**Click:** Instantly downloads a `.csv` file to your computer.  
**What happens:** No server call. The button takes all post data already loaded on the page and turns it into a CSV string entirely in the browser, then triggers a download. File is named `overview-report.csv`.  
**Who can use:** Everyone.

### Failed Posts — clicking a row (amber alert section)
**Click:** Expands that row in-place to show a full detail panel.  
**What happens (on expand):** The browser queries Supabase `auto_fix_events` table for all error events that happened on the same date as that post. It then shows:
- The full Post ID (copyable)
- Exact upstream error from Blotato (if captured), with a plain-English "How to fix" explanation
- All hashtags on that post
- Related auto-fix events from that day
- Action buttons (see below)

### Failed Posts — "Mark Resolved" button (inside expanded row)
**Click:** Shows a confirmation popup: *"Mark this post as resolved? Use this only if you've actually verified the issue is handled..."*  
**If confirmed:** Writes `failure_resolved: true` and a timestamp to that post's row in Supabase `posts` table. The row immediately disappears from the failed-posts alert. If you refresh the page, it stays gone because the query filters out resolved posts.  
**Who can use:** Admin only (button is hidden for viewers).

### Failed Posts — "Copy Post ID" button
**Click:** Copies the full Blotato Post ID (UUID) to your clipboard. Button briefly shows "Copied!" for 1.5 seconds.  
**What happens:** No server call. Pure clipboard write. You then paste it into Blotato's search bar at my.blotato.com/failed to find that exact failed submission.  
**Who can use:** Everyone.

### Failed Posts — "View failed posts on Blotato" link
**Click:** Opens `https://my.blotato.com/failed` in a new tab.  
**Who can use:** Everyone.

### Failed Posts — "Open on TikTok" link (if URL exists)
**Click:** Opens the TikTok post URL in a new tab.  
**Who can use:** Everyone.

### Failed Posts — "View all N unposted items" link (bottom of table)
**Click:** Navigates to the `/posts` page.

### Top Performing Content — "View all" link
**Click:** Navigates to `/posts`.

### Recent Experiments — "View all" link
**Click:** Navigates to `/experiments`.

### Account Leaderboard — clicking an account row
**Click:** Navigates to `/accounts/{handle}` (that account's detail page).

### Account Leaderboard — "View all accounts" link
**Click:** Navigates to `/accounts`.

### Format Rankings — clicking a format row
**Click:** Navigates to `/formats`.

### Format Rankings — "View details" link
**Click:** Navigates to `/formats`.

---

## Posts Page (`/posts`)

### Export CSV
**Click:** Downloads `posts.csv` containing every visible post: date, account, hook style, format, flow, views, likes, saves, save rate, status, TikTok URL.  
**What happens:** No server call. Built from data already on the page.

### TikTok "View" link (per row)
**Click:** Opens that post's TikTok URL in a new tab.

### Status pill (per row — green/orange/blue/grey)
**Display only.** No click action. Shows the current post status: published / scheduled / pending / draft.

---

## Accounts Page (`/accounts`)

### Date Range Filter
Same as Overview — filters all performance numbers to that date window.

### Export CSV
Downloads `accounts.csv` with: account handle, followers, views, likes, saves, avg save rate, posts, last posted date.

### Add Account button (admin only)
**Click:** Opens an inline form below the button with four fields: Blotato Account ID, TikTok Handle, Display Name, Notes.

#### Inside the Add Account form:

**Cancel button:**  
Closes the form without saving anything. No server call.

**Add Account button (inside form):**  
**Click:** Validates the three required fields (Blotato ID, name, handle). If missing → shows inline error message.  
**If valid:** Inserts a new row into Supabase `accounts` table with `active: true`. The new account immediately appears in the managed-accounts table. The page auto-refreshes (Next.js `router.refresh()`).  
**What this means for the pipeline:** The new account is now available for cycle runs. The scheduler will include it in batches that target "all active accounts".

### Per-account Power button (toggle active/pause) (admin only)
**Click:** No confirmation popup. Immediately flips `active` field in Supabase `accounts` table.  
- If account was ACTIVE → sets to PAUSED. Row turns grey. Scheduler stops including this account in cycles.  
- If account was PAUSED → sets to ACTIVE. Scheduler includes it again.  
**Who can use:** Admin only.

### Per-account Delete button (trash icon) (admin only)
**Click:** Confirmation popup: *"Delete account [name]? This removes it from the cycle. Existing posts/analytics stay in place."*  
**If confirmed:** Deletes the row from Supabase `accounts` table. Account disappears from the table immediately. All historical posts and analytics data for that account remain untouched — only the account config is removed.  
**Who can use:** Admin only.

### Account row — clicking a row (Performance table at bottom)
**Click:** Navigates to `/accounts/{handle}`.

---

## Account Detail Page (`/accounts/[handle]`)

### "← All accounts" link
**Click:** Navigates back to `/accounts`.

### Date Range Filter
Filters all KPIs and the chart to that date window for this specific account.

### TikTok "View" link (per row in posts table)
Opens that post's TikTok URL in a new tab.

---

## Experiments Page (`/experiments`)

### Account filter buttons (e.g. "@yournotetaker", "@grow.withamanda")
**Click:** Adds `?account=yournotetaker` to the URL. The page reloads showing only experiments for that account. Click again to deselect and show all.

### Export CSV
Downloads `experiments.csv` with all experiment data: ID, date, account, variable, both variants, views/saves/save-rate for A and B, status, winner.

---

## Formats Page (`/formats`)

### Export CSV
Downloads `format-rankings.csv` with: rank, hook style, avg views, avg save rate, post count, last used date.

### Clicking a format card
**Click:** Navigates to `/posts` so you can browse posts for that format.

---

## Hashtags Page (`/hashtags`)

### Date Range Filter
Filters hashtag performance data to that date window. Recalculates all views, likes, saves per hashtag from posts in that range.

---

## Live Runs Page (`/runs`)

### "Run Cycle Now" button (admin only)
**Click:** Opens the cycle configuration form.

#### Inside the Run Cycle Now form:

**Flow toggle buttons (Flow 1, Flow 2, Flow 3):**  
**Click:** Toggles that flow on/off (highlighted = selected). You can select multiple flows — they run one after another in the same cycle. At least one must be selected.

**Account toggle buttons (@handle):**  
**Click:** Toggles that account on/off. If none selected, the cycle runs on all active accounts. Accounts shown are those currently ACTIVE in the `accounts` table.

**Posts per account field:**  
Numeric input, min 1 max 20. Controls how many posts are generated and sent for each account in this run.

**Posting path dropdown:**  
- "UPLOAD — TikTok drafts": posts land in the TikTok app as drafts (admin must open TikTok app and tap Publish)  
- "DIRECT_POST — publish now": posts are submitted live to TikTok immediately

**Skip research toggle:**  
ON = skip the Virlo trend-fetch step (saves API credits). OFF = fetch fresh trends before generating.

**Cancel button (inside form):**  
Closes the form. No action.

**Submit Job button:**  
**Click:** Validates at least one flow is selected.  
**What happens:** Inserts a row into Supabase `cycle_jobs` table with all chosen settings and status `"pending"`. The form closes and a green banner appears showing "Queued — waiting for Mac to pick up (≤60s)".  
**On the Mac:** The scheduler tick (runs every 5 min) polls `cycle_jobs` for pending rows. Within up to 60 seconds it claims the job (sets status to `"claimed"`) and starts running the cycle. The banner updates to "Running on the Mac…"  
**Who can use:** Admin only.

### Active job banner — "View live →" link
Appears once the job has a linked `cycle_run_id`. Navigates to `/runs?run={id}` to see the live timeline.

### Active job banner — "Cancel" button
**Click:** Confirmation popup: *"Cancel this pending job? (Already-claimed jobs can't be cancelled...)"*  
**If confirmed:** Updates job status to `"cancelled"` in Supabase. Works only if the job is still `"pending"` — once the Mac has `"claimed"` it, this button has no effect on the running process (the cycle will finish its current phase).

### Run list — clicking a run card
**Click:** Selects that run and shows its event timeline in the right panel. The selected card gets a blue ring.

### Run detail — "Cancel running cycle" button (running cycles only)
**Click:** Confirmation popup explaining that already-submitted posts cannot be unposted.  
**If confirmed:** Sets `status: "cancelled"` and `ended_at` timestamp in Supabase `cycle_runs` table. The Mac process checks this flag between phases (not mid-phase). It will stop before the next phase starts — up to ~30 seconds for it to notice.  
**Who can use:** Admin only (button only appears for admins).

### Run detail — "Delete from history" button (completed/failed/cancelled cycles)
**Click:** Confirmation popup: *"Delete this run from history? Removes the run + all its events. Cannot be undone."*  
**If confirmed:** Deletes all rows from `cycle_events` for this run, then deletes the row from `cycle_runs`. The run disappears from the list immediately.  
**Who can use:** Admin only.

---

## Autoresearch Brain Page (`/autoresearch`)

### Decision list — clicking a run row
**Click:** Expands that run to show the full detail panel including: hypothesis, account health context the brain evaluated, warnings the brain flagged, strategy notes, and which experiment variants were set.

### Brain log rows — clicking a day entry
**Click:** Expands to show that day's full learning summary: top hooks, top hashtags, trending topics, winners declared, losers dropped, and phase timing breakdown.

*Note: This page has no write buttons — it is a read-only log. The brain runs autonomously at 08:30 daily on the Mac and writes to Supabase directly. The page polls Supabase every 15 seconds and updates automatically.*

---

## Errors & Auto-Fix Page (`/errors`)

### Source / Tier / Handled filter buttons (top of table)
**Click:** Adds the filter as a URL param (`?source=blotato`, `?tier=HUMAN-ONLY`, etc.). Page reloads with filtered data.

### Error row — clicking a row
**Click:** Expands that row to show full details: exact timestamp, full error message, action the auto-fixer took, fix description (if a code change was proposed or applied), and verification duration.

### Expanded row — "Mark Resolved" button (admin only)
**Click:** Updates `handled: "resolved"` and `resolution: "Marked resolved by admin"` on that event in Supabase `auto_fix_events`. The status badge on that row changes from red "escalated"/"gave-up" to green "resolved". Use this after you've manually fixed the underlying issue.  
**Who can use:** Admin only (button hidden for viewers).

---

## Settings — Profile (`/settings`)

### Notification toggles (System Updates, Content Insights, Team Activity)
**Click:** Flips the toggle on/off locally. Does **not** save immediately — you must click Save Changes.

### Discard Changes button
**Click:** Resets all fields (Display Name, Bio, all three notification toggles) back to the values loaded from the database when the page opened. No server call.

### Save Changes button
**Click:** Simultaneously writes two records to Supabase:
1. Updates `profiles` table: `display_name`, `bio`
2. Upserts `notification_prefs` table: all three toggle states + updated timestamp

If either write fails, shows a red error banner. If both succeed, button briefly shows "Saved!" for 2 seconds then returns to normal.

---

## Settings — Schedule (`/settings/schedule`)

### Master scheduler toggle (ON/OFF switch)
**Click:** Flips the toggle locally. Does **not** save immediately — you must click Save Changes.  
**Effect when saved OFF:** The Mac's scheduler tick still runs every 5 minutes but sees `enabled: false` in Supabase and skips all batches. No cycles fire until you turn it back on.

### Timezone dropdown
**Click:** Selects a new timezone. Does **not** save immediately. The "Next run" preview in the status card updates in real-time to show what the new timezone would mean for upcoming batches.

### Save Changes button (Schedule)
**Click:** Updates `schedule_settings` row (id=1) in Supabase with the new `enabled` value and/or `timezone`. Disabled if nothing has changed.  
If save succeeds → "Saved!" for 2 seconds.

### Batch Manager — Up/Down arrow buttons (per batch row) (admin only)
**Click:** Swaps the `order_index` of this batch with the one above or below it in Supabase `cycle_batches` table. The list reorders immediately. Order controls which batch runs first if multiple batches are scheduled for the same time.

### Batch Manager — Enable/Disable toggle (power icon per batch) (admin only)
**Click:** Flips `enabled` on that batch row in Supabase. Disabled batches are greyed out and skipped by the scheduler tick.

### Batch Manager — Edit button (pencil icon per batch) (admin only)
**Click:** Turns that row into an inline edit form with all fields editable: label, run time, flows (multi-select), accounts (multi-select), posting path, posts per account, skip research toggle, schedule offset.  
**Save (checkmark):** Writes all changes to that row in Supabase `cycle_batches`. The row exits edit mode.  
**Cancel (X):** Discards changes, exits edit mode. No server call.

### Batch Manager — Delete button (trash icon per batch) (admin only)
**Click:** Confirmation popup: *"Delete batch [label]?"*  
**If confirmed:** Deletes that row from Supabase `cycle_batches`. Batch disappears immediately. The scheduler will no longer run it.

### Batch Manager — "Add batch" button (admin only)
**Click:** Adds a new blank row at the bottom of the table in edit mode, pre-filled with defaults (19:00, photorealistic, draft, 1 post/account).  
**Save on the new row:** Inserts into Supabase `cycle_batches`. Batch is now live and will fire at its configured time.  
**Cancel on the new row:** Removes the blank row without saving.

---

## Settings — Alerts (`/settings/alerts`)

### "Add rule" button (inside the new alert form)
**Click:** Adds another rule row to the form (metric + condition + threshold). Each rule fires the webhook independently when its condition is met.

### "×" button next to a rule row
**Click:** Removes that rule from the form locally. Minimum 1 rule must remain (button only shows when there are 2+ rules).

### "Save Alert" button
**Click:** Validates webhook URL is not empty.  
**What happens:** Inserts a new row into Supabase `alert_config` with: type (Slack/Discord), webhook URL, rules array, `enabled: true`. The new alert card appears at the top of the active configurations list immediately.

### Per-alert "Enable" / "Disable" button
**Click:** No confirmation. Flips `enabled` in Supabase for that alert config. Active alerts send webhooks when thresholds are hit; disabled ones are silenced.

### Per-alert delete (trash icon)
**Click:** No confirmation. Deletes that row from Supabase `alert_config`. Card disappears immediately.

---

## Settings — Sharing (`/settings/sharing`)

### Account toggle buttons (in the Create share link form)
**Click:** Toggles that account in/out of the share link's account filter. Highlighted = included. If none are selected, the shared link shows data for all accounts.

### "Create share link" button
**Click:** Inserts into Supabase `share_links` table: title, accounts array (null = all), expiry date (null = never). Supabase auto-generates a random `token`.  
**Result:** A new row appears in the Active Links table. The share URL is `{your-domain}/share/{token}`.

### Share link — Copy button (clipboard icon)
**Click:** Copies the full share URL (`https://your-domain.com/share/{token}`) to your clipboard. Icon briefly shows a green checkmark for 2 seconds.

### Share link — Delete button (trash icon)
**Click:** No confirmation. Deletes that row from Supabase `share_links`. Anyone who had the link will now get a 404 if they try to visit it.

---

## Shared Public Dashboard (`/share/[token]`)

This page has **no buttons**. It is a fully read-only view for external viewers. The only content is KPI cards and a views chart. No login required to access it. If the share link has an expiry date that has passed, the page shows an "This link has expired" message instead of data.

---

## Login Page (`/login`)

### "Sign in" button
**Click:** Calls Supabase Auth with the entered email + password.  
**If correct:** Sets an auth cookie and redirects to `/` (Overview).  
**If wrong:** Shows an error below the form.

### "Sign up" link
Navigates to `/signup`.

## Sign-up Page (`/signup`)

### "Create account" button
**Click:** Calls Supabase Auth to create a new user with the entered email + password.  
**If successful:** Redirects to `/` (Overview). New accounts start with `viewer` role — an admin must update the role in Supabase if editor/admin access is needed.

---

## Navigation (Sidebar)

Every item in the left sidebar is a link that navigates to that page. There is no hover state or dropdown — clicking goes directly to:  
Overview · Posts · Accounts · Experiments · Formats · Hashtags · Runs · Autoresearch · Errors · Settings (Profile / Schedule / Alerts / Sharing)

### User avatar (bottom of sidebar)
**Click:** Navigates to `/settings`.

### Sign out
**Click:** Calls Supabase Auth `signOut()`, clears the auth cookie, redirects to `/login`.
