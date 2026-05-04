# Setup Guide — Moving the Automation to a New Mac

This guide walks through everything needed to get the MinuteWise TikTok automation running on a fresh Mac. Designed so mam can do it without dev help, but a developer can scan the same steps.

**Estimated time:** 30–45 minutes (most of it waiting for installs).

---

## 0. Before you start — what you need ready

| Item | Where to get it | Why |
|------|------------------|-----|
| Mac running macOS 13+ | — | The launchd scheduler is macOS-specific. |
| Apple ID | — | Needed by Homebrew (the installer below). |
| 4 API keys | Aditya / 1Password / Bitwarden | `VIRLO_API_KEY`, `GEMINI_API_KEY`, `BLOTATO_API_KEY`, `SCRAPECREATORS_API_KEY` |
| Supabase service-role key | Aditya / Supabase project mkqarsodftnlcuscsrii | For dashboard sync (the "anon" key is already in the repo, the service-role one is private) |
| GitHub access | Existing org / Aditya | To `git clone` the repo |
| TikTok app updated on phones | App Store / Play Store | For draft batch to land successfully |

⚠️ **Never paste API keys into Slack, email, or git.** Use a password manager (1Password, Bitwarden) or an encrypted note.

---

## 1. Install prerequisites

Open **Terminal** (Cmd+Space → "Terminal" → Enter) and paste each block one at a time.

### 1a. Homebrew (the macOS package manager)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After it finishes, follow the *"Next steps"* it prints (usually two `eval ...` lines to add Homebrew to your PATH). Paste those into the same Terminal window.

### 1b. Node.js, Python, Git

```bash
brew install node python git
```

Verify each one printed a version when you run:

```bash
node --version    # should show v20+
python3 --version # should show 3.10+
git --version
```

### 1c. Python image library (for the text-overlay step)

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
```

Save (`Cmd+S`) and close the editor.

For the dashboard, also add the **Supabase service-role key**:

```bash
open -e dashboard/.env.local
```

Confirm both lines are present (the URL and anon key are already there). Add the service-role key on a new line:

```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   # from Supabase dashboard → Settings → API
```

Save and close.

---

## 5. Quick sanity check (no posting yet)

```bash
npm run analytics
```

This pulls TikTok metrics for both active accounts. If it prints `analytics complete` with no red errors, the API keys work.

---

## 6. Set up the daily 7 PM scheduler

```bash
bash scripts/setup_launchd.sh
```

This installs two macOS launchd jobs:

- **`com.minutewise.dailyflow`** — fires every day at 7:00 PM IST
- **`com.minutewise.dailyflow.catchup`** — hourly safety net (only runs after 7 PM if the primary missed)

Verify they registered:

```bash
launchctl list | grep minutewise
```

You should see two lines.

---

## 7. Run the healthcheck

```bash
npm run healthcheck
```

This prints a green/red status board for: launchd registration, last-run time, lock state, and recent log activity. **Everything should be green** before walking away.

---

## 8. (Optional) Start the dashboard

```bash
cd dashboard
npm run dev
```

Open http://localhost:3000 in a browser to see analytics, errors, top posts, etc.

To stop it, return to that terminal window and press `Ctrl+C`.

---

## 9. What runs nightly without you doing anything

```
7:00 PM  — Batch 1 (2 photorealistic posts published live to TikTok)
7:00 PM  — Batch 2 (2 animated drafts saved to TikTok app inbox)
1:00 AM  — Batch 3 (2 emoji-overlay posts published, scheduled via Blotato)
~7:25 PM — Daily refresh: analytics, optimizer, dashboard sync
```

**Mam's manual step:** open the TikTok app on each phone after 7 PM, find the draft notification (🔔 icon), and publish it.

Full schedule and per-account breakdown: see the daily schedule mam already received.

---

## 10. Day-to-day: useful commands

| What | Command |
|------|---------|
| Run a cycle right now (manual) | `npm run cycle` |
| Pull analytics | `npm run analytics` |
| Daily refresh (analytics + optimizer + sync) | `npm run refresh` |
| Healthcheck | `npm run healthcheck` |
| View today's log | `cat data/cycle-logs/launchd-daily.log` |
| Check what auto-fix caught | `cat data/auto-fix-log.md` |
| Inspect any error string | `npx tsx scripts/auto_fix/check.ts "<error>"` |

---

## 11. If something breaks

| Symptom | First thing to check |
|---------|----------------------|
| 7 PM didn't fire | `launchctl list \| grep minutewise` — both jobs should be listed |
| Posts failing on Thomas only | Update the TikTok app on Thomas's phone (App Store) |
| Posts failing on yournotetaker only | Probably suppression — wait, don't change anything |
| "out of credits" mail | Top up the corresponding API at the provider's dashboard |
| Dashboard shows stale data | Run `npm run refresh` manually |
| Scheduler stuck | `bash scripts/teardown_launchd.sh && bash scripts/setup_launchd.sh` |

---

## 12. Where everything lives

```
~/social-media-automation/
  ├── main.ts                  # entry point for npm run cycle
  ├── config/config.ts         # API endpoints, account IDs
  ├── scripts/                 # all pipeline scripts
  │   ├── daily_runner.sh      # the script launchd fires at 7 PM
  │   ├── setup_launchd.sh     # one-time scheduler install
  │   ├── healthcheck.sh       # status board
  │   └── auto_fix/            # error classifier + retry framework
  ├── data/                    # markdown data files + logs
  │   ├── POST-TRACKER.md      # all posts with metrics
  │   ├── ACCOUNT-STATS.md     # daily follower/view snapshots
  │   ├── auto-fix-log.md      # error audit trail
  │   └── cycle-logs/          # per-run log files
  ├── posts/                   # archived slide images (one folder per post)
  ├── dashboard/               # Next.js dashboard (separate npm install)
  └── docs/                    # local copies of API references
```

---

## 13. Handover checklist (Aditya → mam)

- [ ] Share the 4 API keys via 1Password / Bitwarden (NOT Slack)
- [ ] Share the Supabase service-role key the same way
- [ ] Walk through this guide live once
- [ ] Run `npm run healthcheck` together — confirm all green
- [ ] Wait until 7 PM together — watch one full cycle complete
- [ ] Make sure mam can SSH or otherwise reach the laptop if something hangs
- [ ] Hand over phone access for the two TikTok accounts (or confirm mam already has it)

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
