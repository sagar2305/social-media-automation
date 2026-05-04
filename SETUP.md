# Setup Guide — Moving the Automation to a New Mac

This guide walks through everything needed to get the MinuteWise TikTok automation running on a fresh Mac. Designed so mam can do it without dev help, but a developer can scan the same steps.

**Estimated time:** 30–45 minutes (most of it waiting for installs).

---

## TL;DR — what this system is

A Mac runs five `launchd` jobs in the background. The Mac doesn't need a terminal open, doesn't need Claude Code, doesn't need any app running — just needs to be awake. All scheduling, account management, manual triggers, and live status are controlled from a Vercel-hosted dashboard. Everything routes through Supabase as the single source of truth.

```
Vercel dashboard ←──── Supabase ←──── Mac (launchd)
   (mam configures)                     (worker, posts to TikTok)
```

---

## 0. Before you start — what you need ready

| Item | Where to get it | Why |
|------|------------------|-----|
| Mac running macOS 13+ | — | The launchd scheduler is macOS-specific. |
| Apple ID | — | Needed by Homebrew (the installer below). |
| 4 API keys | Aditya / 1Password / Bitwarden | `VIRLO_API_KEY`, `GEMINI_API_KEY`, `BLOTATO_API_KEY`, `SCRAPECREATORS_API_KEY` |
| Supabase URL + anon key | `dashboard/.env.local` already has these | Cycle telemetry + dashboard reads |
| GitHub access | Existing org / Aditya | To `git clone` the repo |
| Vercel deploy access | Sir (whoever holds the Vercel login) | To deploy/view the dashboard publicly |
| TikTok app updated on phones | App Store / Play Store | For draft batch to land successfully |

⚠️ **Never paste API keys into Slack, email, or git.** Use a password manager (1Password, Bitwarden) or an encrypted note. The `.env.local` file is gitignored.

---

## 1. Install prerequisites

Open **Terminal** (Cmd+Space → "Terminal" → Enter) and paste each block one at a time.

### 1a. Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the *"Next steps"* it prints (usually two `eval ...` lines to add Homebrew to PATH). Paste those into the same Terminal window.

### 1b. Node.js, Python, Git

```bash
brew install node python git
```

Verify each one printed a version:

```bash
node --version    # should show v20+
python3 --version # should show 3.10+
git --version
```

### 1c. Python image library (used by overlay-text.py)

```bash
pip3 install Pillow
```

---

## 2. Get the project

```bash
cd ~
git clone https://github.com/sagar2305/social-media-automation.git
cd social-media-automation
```

The whole project now lives at `~/social-media-automation`.

---

## 3. Install JavaScript dependencies

```bash
npm install
cd dashboard
npm install
cd ..
```

(Two `npm install`s — one for the automation, one for the dashboard.)

---

## 4. Add the API keys

```bash
cp .env.example .env.local
open -e .env.local
```

A text editor opens. Paste each API key after the corresponding `=`:

```
VIRLO_API_KEY=virlo_tkn_...
GEMINI_API_KEY=AIzaSy...
BLOTATO_API_KEY=...
SCRAPECREATORS_API_KEY=...

# Supabase — used by scheduler tick, autoresearch, and cycle telemetry
NEXT_PUBLIC_SUPABASE_URL=https://mkqarsodftnlcuscsrii.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

Save (`Cmd+S`) and close.

The dashboard sub-project also needs its own `.env.local`:

```bash
open -e dashboard/.env.local
```

It should already have the Supabase URL and anon key checked into the template. Confirm both are present.

---

## 5. Quick sanity check (no posting yet)

```bash
npm run analytics
```

Pulls TikTok metrics for the active accounts. If it prints `analytics complete` with no red errors, the API keys work.

---

## 6. Activate the 5 background jobs

```bash
bash scripts/setup_launchd.sh
```

This installs five macOS `launchd` jobs that drive everything:

| Job label | Interval | What it does |
|-----------|----------|--------------|
| `com.minutewise.scheduler.tick` | every 5 min | Reads dashboard-managed schedule + batches, fires due batches |
| `com.minutewise.jobs.poller` | every 60 sec | Picks up "Run Cycle Now" requests from the dashboard |
| `com.minutewise.autoresearch` | daily 08:30 | Calls Gemini to design tomorrow's experiment, queues two cycle jobs |
| `com.minutewise.dailyflow` | daily 19:00 | Legacy fixed-time backup |
| `com.minutewise.dailyflow.catchup` | every hour | Safety net if 19:00 was missed |

Verify they registered:

```bash
launchctl list | grep minutewise
```

You should see five lines.

---

## 7. Run the healthcheck

```bash
npm run healthcheck
```

Green/red status board for: launchd registration, last-run sentinel, lock state, and recent log activity. **Everything should be green** before walking away.

---

## 8. Deploy the dashboard to Vercel

The Mac is now the worker. The dashboard is what mam (and any reviewer) actually sees. Anyone with Vercel access deploys it once:

```bash
cd dashboard
npx vercel              # log in once if prompted, link to a Vercel project
```

In Vercel project settings → Environment Variables, add for **Production**:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mkqarsodftnlcuscsrii.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (the JWT from `dashboard/.env.local`) |

Then deploy:

```bash
npx vercel --prod
```

Vercel prints a public URL (e.g. `dashboard-abc.vercel.app`) — share that with mam. Every future `git push` to `main` redeploys automatically.

---

## 9. Daily operation — what runs without anyone touching it

```
08:30 — autoresearch fires → Gemini designs the day's experiment → queues 2 cycle jobs
08:31 — jobs poller picks them up (60s tick) → cycle starts
        → Gemini generates slides, Blotato uploads as drafts, telemetry to Supabase
Throughout the day — scheduler tick (5 min) checks if any cycle_batches are due
                     and fires them at their configured times
19:00 — legacy daily flow fires (kept as backup until you remove it)
```

**Mam's manual step:** open the TikTok app on each phone, find any draft notifications, and publish them.

Mam controls everything from the Vercel dashboard:

| Page | What mam does there |
|------|---------------------|
| `/` | Overview KPIs, recent activity |
| `/runs` | **Live cycle progress** — every phase, every post, every error in real time. Plus the "Run Cycle Now" button. |
| `/accounts` | Add / pause / delete TikTok accounts. Pipeline picks up changes within minutes. |
| `/posts` | All published posts with metrics |
| `/experiments` + `/autoresearch` | What's being tested, what won, what Gemini chose for tomorrow |
| `/errors` | Auto-fix events with clear suggested actions for any HUMAN-ONLY failures |
| `/settings/schedule` | Master toggle, timezone, per-batch CRUD (time, flows, accounts, posts/account, path, schedule offset) |
| `/formats` + `/hashtags` | Performance rankings used by content generation |

**Nothing on the Mac needs to be opened, edited, or babysat.** The Mac is just an always-on background worker.

---

## 10. Day-to-day: useful CLI commands (developer)

| What | Command |
|------|---------|
| Run a cycle right now (manual) | `npm run cycle` |
| Run a specific flow | `npm run cycle -- --flow=1 --path=draft` |
| Pull analytics | `npm run analytics` |
| Daily refresh (analytics + optimizer + sync) | `npm run refresh` |
| Healthcheck | `npm run healthcheck` |
| Today's cycle log | `cat data/cycle-logs/launchd-daily.log` |
| Scheduler tick log | `cat data/cycle-logs/scheduler-tick.log` |
| Jobs poller log | `cat data/cycle-logs/jobs-poller.log` |
| Autoresearch log | `cat data/cycle-logs/autoresearch.log` |
| Inspect any error string | `npx tsx scripts/auto_fix/check.ts "<error>"` |
| Dry-run scheduler (no spawning) | `SCHEDULER_DRY_RUN=1 npx tsx scripts/scheduler_tick.ts` |
| Dry-run jobs poller | `SCHEDULER_DRY_RUN=1 npx tsx scripts/cycle_jobs_poller.ts` |
| List active accounts (per DB) | `npx tsx scripts/account_loader.ts handles` |

---

## 11. If something breaks

| Symptom | First thing to check |
|---------|----------------------|
| Schedule fired nothing | `launchctl list \| grep minutewise` — five jobs should be listed |
| "Run Now" button does nothing | Mac asleep? Wake it. Or check `data/cycle-logs/jobs-poller.log` |
| Posts failing on one account only | Update the TikTok app on that account's phone |
| "out of credits" mail | Top up at the provider's dashboard |
| Dashboard shows stale data | Run `npm run refresh` manually or check Supabase directly |
| Scheduler tick crashing | `cat data/cycle-logs/scheduler-tick.err` |
| Autoresearch made a weird choice | Look at `/autoresearch` page → click the decision → see Gemini's hypothesis. If invalid, code falls back to deterministic next-variable logic |
| Need to skip today's run | Toggle the master scheduler off on `/settings/schedule`. Toggle on tomorrow. |
| Need to disable a single batch | `/settings/schedule` → batch row → power button |
| Reset everything | `bash scripts/teardown_launchd.sh && bash scripts/setup_launchd.sh` |

For any error string from a log, paste it into:

```bash
npx tsx scripts/auto_fix/check.ts "<paste the error here>"
```

The classifier returns the action tier (RETRY / AUTO-FIX / PROPOSE / ASK / HUMAN-ONLY) and the recommended fix from the catalog (28 known patterns).

---

## 12. Where everything lives

```
~/social-media-automation/
  ├── main.ts                    # entry point for npm run cycle
  ├── config/
  │   ├── config.ts              # API endpoints (accounts come from Supabase now)
  │   ├── caption_templates.csv  # fallback caption templates
  │   └── cta/                   # CTA images
  ├── scripts/
  │   ├── account_loader.ts      # DB-first active-account loader (config.ts fallback)
  │   ├── scheduler_tick.ts      # 5-min: reads cycle_batches, fires due ones
  │   ├── cycle_jobs_poller.ts   # 60s: claims pending Run Now requests
  │   ├── autoresearch.ts        # daily: Gemini designs next experiment
  │   ├── cycle_reporter.ts      # writes cycle_runs/cycle_events for live UI
  │   ├── daily_runner.sh        # legacy 19:00 flow (still kept as backup)
  │   ├── setup_launchd.sh       # one-time installer for all 5 plists
  │   ├── teardown_launchd.sh    # un-installer
  │   ├── healthcheck.sh         # status board
  │   └── auto_fix/              # error classifier + retry framework (28-entry catalog)
  ├── data/                      # markdown content + state (sentinels gitignored)
  │   ├── POST-TRACKER.md, ACCOUNT-STATS.md, EXPERIMENT-LOG.md, FORMAT-WINNERS.md, ...
  │   ├── auto-fix-log.md        # error audit trail
  │   └── cycle-logs/            # per-run launchd log files (gitignored)
  ├── posts/                     # archived slide images, one folder per post (gitignored)
  ├── dashboard/                 # Next.js dashboard (separate npm install)
  │   └── src/
  │       ├── app/(dashboard)/   # /runs, /accounts, /autoresearch, /settings/schedule, ...
  │       └── components/        # account-manager, batch-manager, run-now-button, runs-live, ...
  └── docs/                      # local copies of API references (Virlo, Gemini, Blotato, ScrapeCreators)
```

---

## 13. Handover checklist (Aditya → mam → sir)

### Aditya before handing off

- [ ] Share API keys via 1Password / Bitwarden (NOT Slack)
- [ ] Confirm sir has Vercel access
- [ ] Push final code to `main` on GitHub
- [ ] Run `bash scripts/teardown_launchd.sh` on your own Mac so it stops being the worker
- [ ] Walk mam through the dashboard once

### Sir's deploy steps (one-time)

- [ ] Pull the repo: `git pull origin main`
- [ ] `cd dashboard && npx vercel` — link the Vercel project
- [ ] Set env vars in Vercel dashboard (Supabase URL + anon key)
- [ ] `npx vercel --prod` — production deploy
- [ ] Send the public URL to mam

### Mam (whichever Mac will run the cycle)

- [ ] Follow sections 1–7 above
- [ ] Run `npm run healthcheck` — confirm five plists registered, all green
- [ ] Wait until next configured batch time — watch `/runs` page on dashboard
- [ ] Confirm a cycle finishes successfully
- [ ] Hand over phone access for the active TikTok accounts

---

## 14. Architectural note for future maintainers

This system has **no Claude Code dependency** at runtime. The previous version used `claude /loop` to drive autoresearch — that has been replaced with a Node script that calls Gemini directly. Claude Code is now only used for development (writing new features, debugging code). Production runs purely on `launchd + Node + Gemini`.

The system can be migrated off the Mac entirely (to Render / Railway / Fly.io / a cloud VM) by porting the five launchd plists to whatever scheduler that platform uses. Nothing in the code is Mac-specific except the plist files.

---

## Questions / issues

- Project source: https://github.com/sagar2305/social-media-automation
- Supabase project: https://supabase.com/dashboard/project/mkqarsodftnlcuscsrii
- Blotato dashboard: https://my.blotato.com
- ScrapeCreators dashboard: https://scrapecreators.com/dashboard
- Gemini billing / spending cap: https://ai.studio/spend
- Virlo dashboard: https://virlo.ai

If a step throws an error that's not on the troubleshooting list, copy the error and paste it into:

```bash
npx tsx scripts/auto_fix/check.ts "<paste the error here>"
```

The classifier will tell you what kind of error it is and the recommended fix.
