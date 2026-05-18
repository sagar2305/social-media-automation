# MinuteWise TikTok Dashboard — Feature Overview

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth) · Tailwind CSS · shadcn/ui  
**Data source:** Supabase database, synced from local automation pipeline via `npm run refresh`

---

## Pages & Features

### 1. Overview (Home)

The main command centre. Shows a real-time snapshot of how all accounts are performing.

- **KPI cards** — Total Views, Total Likes, Total Saves, and Avg Save Rate (filterable by date range)
- **Failed Posts alert** — Amber banner that appears when any post has an error, in-progress failure, or was never confirmed published. Each row is expandable for details and has admin-level Mark Resolved controls
- **Audience Growth chart** — Line chart of daily views over time across all accounts
- **Top Performing Content** — Top 5 posts ranked by views, with account badge and direct TikTok link
- **Recent Experiments** — Last 10 A/B tests in a compact table with variant comparison and winner status
- **Account Leaderboard** — All accounts ranked by total views, with saves and post count. Clickable to drill into each account
- **Format Rankings** — Hook styles ranked by avg views and save rate; links to the full Formats page
- **Date Range Filter** — "Last 7 days / 30 days / 90 days / All time" URL-param filter that applies across KPIs, charts, and tables

---

### 2. Posts

A flat, date-sorted table of every post across all accounts.

- All posts sorted by date descending (most recent first)
- Per-row data: Date + account handle (shown inline), Hook Style, Format, Flow, Views, Likes, Saves, Save %, Status, TikTok link
- **Status pill** colour-coded: green = published, orange = scheduled, blue = pending/in-progress, grey = draft
- Stats summary in header: Total / Published / Drafts count
- **Export to CSV** button — downloads all visible posts as a spreadsheet

---

### 3. Accounts

#### Accounts List

- Summary table for each tracked account: Followers, Views, Likes, Saves, Avg Save %, Posts, Last Posted
- Date range filter to scope performance to any window
- **Export to CSV** of account summary data
- **Account Manager** (admin only) — edit account name, handle, active/inactive toggle, and notes. Add new accounts or deactivate existing ones directly from this page

#### Account Detail (`/accounts/[handle]`)

- Per-account KPI cards: Views, Likes, Saves, Avg Save %, Total Posts, Followers
- Views over time chart scoped to that account
- Full post history table for that account with all metrics and status
- Date range filter applies to all data on the page

---

### 4. Experiments

Full A/B test history and results.

- Table of all experiments: ID, Date, Account(s), Variable tested, Variant A vs B, Views A/B, Saves A/B, Save Rate A/B, Status
- **Account filter** — filter experiments by account (supports multi-account cross-tests, marked with a "Cross" badge)
- Status badges: Active (green), Winner (dark green), Inconclusive (orange)
- Stats in header: Total experiments / Winners count
- **Export to CSV**

---

### 5. Format Rankings

Hook style performance analysis.

- **Bar chart** — visual comparison of all hook styles by average views
- **Ranked cards** — each hook style shown as a card with Avg Views, Save Rate, and Post Count
- Clicking any card links to the Posts page for deeper analysis
- **Export to CSV**

---

### 6. Hashtags

Performance breakdown by hashtag across all published posts.

- **Top 15 bar chart** — hashtags ranked by total views
- **Full sortable table** — every hashtag with: Views, Likes, Saves, Avg Save %, and number of posts it appeared in
- Date range filter applies across the entire page

---

### 7. Live Runs

Real-time monitoring of every content generation + posting cycle.

- **Run list** — last 20 cycle runs with status icon (running/completed/failed/cancelled), flows and accounts involved, posts done/total, and duration
- **Live indicator** — pulsing green "LIVE" badge when a run is active; auto-refreshes every 4 seconds when live, every 20 seconds when idle
- **Timeline panel** — click any run to see a full event-by-event log: cycle start, phase start, image generation, post submission, errors. Timestamped per event
- **Progress bar** — visual progress bar during active runs
- **Cancel button** — admin can send a cancellation signal to a running cycle (stops future phases; posts already submitted to Blotato cannot be unposted)
- **Delete button** — remove completed/failed/cancelled runs from history
- **Run Now button** (admin) — manually trigger a new cycle: choose flows (Photorealistic / Animated / Emoji Overlay), accounts, and posting mode (Direct or Draft)

---

### 8. Autoresearch Brain

Autonomous AI experimentation log and live decision feed.

- List of the last 30 brain runs with decision type badge, timestamp, and status
- **Strategy Fix alert** — red banner when the brain detects a performance crash or account suppression and switches from normal experimentation to issuing a remediation strategy
- **Warning badges** — per-run warnings the brain flagged (e.g. "low hashtag diversity", "overposting detected")
- **Decision detail panel** — expand any run to see: full experiment hypothesis, account health context the brain evaluated, strategy notes, and whether the run resulted in posts being generated
- **Admin controls** — trigger a manual brain run; mark a run as reviewed

---

### 9. Errors & Auto-Fix

Live log of every API error the pipeline encountered and how it was handled.

- **KPI cards** — Last 24h events, Closed (auto-fixed / auto-retried / resolved), Open (needs attention), Total tracked
- **Event table** with expandable rows: Timestamp, Tier (AUTO-FIX / PROPOSE / ASK / HUMAN-ONLY / RETRY), Source (blotato / gemini / scrapecreators / etc.), HTTP Status, Error Signature, Action taken, Handled state
- **Tier colour coding** — each tier has a distinct colour badge so severity is immediately visible
- **Filters** — filter by source, tier, or handled state
- **Mark Resolved** (admin) — for escalated errors that needed manual intervention, admins can mark them resolved once fixed
- Refreshes every 60 seconds

---

### 10. Settings

#### Profile (`/settings`)
- Update display name and bio
- Notification preferences: System Updates, Content Insights, Team Activity (per-user toggles)

#### Schedule (`/settings/schedule`)

Two sub-sections:

**Global Schedule Toggle**
- Enable / disable the entire automated scheduler
- Shows timezone (Asia/Kolkata), last run date, and last run timestamp

**Batch Manager** (admin)
- View all configured cycle batches (e.g. "Morning-Animated", "Evening-Photorealistic")
- Per batch: label, run time, flows, posting mode (Direct / Draft), target accounts, posts per account, skip-research toggle, schedule offset
- Reorder batches by priority (up/down arrows)
- Enable / disable individual batches
- Add new batches or delete existing ones
- Last run date shown per batch so you can see when each last fired

#### Alerts (`/settings/alerts`)
- Configure Slack and Discord webhook notifications for performance milestones
- Create alert rules: choose platform (Slack / Discord), webhook URL, metric (views / saves / save rate), threshold, and which accounts to watch
- Edit or delete existing alert configurations
- Active configurations listed as cards showing all their settings

#### Sharing (`/settings/sharing`)
- Create read-only public share links for external stakeholders (e.g. your manager, a client)
- Per link: title, optional account filter (share only specific accounts), optional expiry date
- Generated links use a secure token; no login required to view
- Manage and delete existing share links

---

### 11. Public Shared Dashboard (`/share/[token]`)

A stripped-down, login-free view for external viewers.

- Respects account filter and expiry date set when the link was created
- Shows: KPI cards (Views, Likes, Saves, Avg Save Rate, Posts, Followers), views over time chart
- Branded "MinuteWise · Shared" header with the link title
- Returns an expired message if the link's expiry date has passed

---

### 12. Authentication

- Email + password login and sign-up (`/login`, `/signup`)
- Supabase Auth with JWT cookies via `@supabase/ssr`
- Role-based access: `admin` vs `viewer` — admin-only features (batch editing, run triggers, mark-resolved) are hidden from viewers
- Session persists across page refreshes via server-side cookie

---

## Cross-Cutting Capabilities

| Feature | Detail |
|---|---|
| **Date Range Filter** | 7 / 30 / 90 days / All Time. Applied via URL param (`?range=7d`) so it persists on refresh and is shareable |
| **Export to CSV** | Available on Overview, Posts, Accounts, Experiments, and Formats pages |
| **Incremental Static Regeneration** | Most pages use `revalidate = 300` (5-minute ISR) to serve fast cached pages while staying fresh. Runs and Autoresearch pages use `force-dynamic` for always-live data |
| **Supabase real-time polling** | Live Runs page polls Supabase directly from the browser on a 4 s / 20 s adaptive interval — no WebSocket setup required |
| **Responsive layout** | Sidebar nav collapses on mobile; all tables scroll horizontally on small screens |

---

## Data Flow (How the Dashboard Stays Up to Date)

```
Automation pipeline (local Mac)
  └─ npm run refresh  (runs daily)
       ├─ pull_analytics.ts   → updates POST-TRACKER.md with Blotato post statuses + ScrapeCreators view/save data
       ├─ optimizer.ts        → recalculates FORMAT-WINNERS.md rankings
       ├─ fetch_trends.ts     → refreshes TRENDING-NOW.md and HASHTAG-BANK.md
       └─ sync-to-supabase.ts → upserts all markdown data into Supabase tables
                                (posts, account_stats, experiments, format_rankings, auto_fix_events)

Dashboard (Vercel / localhost)
  └─ reads Supabase → renders pages with ISR or force-dynamic
```

Live Run events are written to Supabase in real-time by `main.ts` as cycles execute, so the Runs page updates live without waiting for a refresh cycle.
