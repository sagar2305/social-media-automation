#!/bin/bash
#
# Register the daily TikTok posting cycle with macOS launchd.
#
# What this does on the target Mac:
#   1. Generates ~/Library/LaunchAgents/com.minutewise.dailyflow.plist
#      with the correct repo path and Node binary baked in
#   2. Loads it with launchctl so it fires every day at 19:00 local time
#   3. Verifies registration
#
# What runs at 19:00:
#   - Chain: 3 cycles back-to-back (npm run flow)
#   - Slot 1 posts go live ~19:30 (after generation)
#   - Slot 2 posts go live at 22:00 (Blotato server-side, +3h)
#   - Slot 3 posts go live at 01:00 next day (Blotato server-side, +6h)
#   - Mac mini just needs to be awake at 19:00.
#
# Run from the repo root on the Mac mini:
#   bash scripts/setup_launchd.sh
#
# To inspect:    launchctl list | grep minutewise
# To unload:     launchctl unload ~/Library/LaunchAgents/com.minutewise.dailyflow.plist
# To view logs:  tail -f data/cycle-logs/launchd-daily.log

set -euo pipefail

TICK_LABEL="com.minutewise.scheduler.tick"
JOBS_LABEL="com.minutewise.jobs.poller"
AUTORESEARCH_LABEL="com.minutewise.autoresearch"
TICK_PLIST_PATH="$HOME/Library/LaunchAgents/$TICK_LABEL.plist"
JOBS_PLIST_PATH="$HOME/Library/LaunchAgents/$JOBS_LABEL.plist"
AUTORESEARCH_PLIST_PATH="$HOME/Library/LaunchAgents/$AUTORESEARCH_LABEL.plist"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_DIR/data/cycle-logs"
LOG_FILE="$LOG_DIR/launchd-daily.log"
ERR_FILE="$LOG_DIR/launchd-daily.err"

# ─── Sanity checks ───────────────────────────────────────────

if [ ! -f "$REPO_DIR/package.json" ]; then
  echo "ERROR: $REPO_DIR doesn't look like the repo root (no package.json)."
  exit 1
fi
if [ ! -f "$REPO_DIR/.env.local" ]; then
  echo "WARNING: $REPO_DIR/.env.local not found. The cycle will fail on first run unless you create it."
  echo "         Required keys: GEMINI_API_KEY, BLOTATO_API_KEY, SCRAPECREATORS_API_KEY, VIRLO_API_KEY,"
  echo "         NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SLACK_ALERT_WEBHOOK (optional)"
  echo ""
  read -p "Continue anyway? [y/N] " ok
  [ "$ok" = "y" ] || exit 1
fi

# Locate Node — Homebrew on Apple Silicon is /opt/homebrew, Intel is /usr/local
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: 'node' not found in PATH. Install Node 22+ via 'brew install node' first."
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# ─── Legacy plists removed ────────────────────────────────────
# The old com.minutewise.dailyflow + com.minutewise.dailyflow.catchup plists
# fired daily_runner.sh at 19:00 with HARDCODED batch config (Flow 1 direct +
# Flow 2 draft + Flow 3 direct). They overrode the dashboard-managed schedule.
#
# Scheduler tick + jobs poller (below) replace them entirely:
#   - schedule batches → cycle_batches table → scheduler_tick reads + fires
#   - manual triggers → cycle_jobs table → jobs_poller reads + fires
#
# This setup script now removes any legacy plists if they're still installed
# and never re-creates them. To restore the legacy behavior, run an older
# version of this script from git history.

for legacy in "com.minutewise.dailyflow" "com.minutewise.dailyflow.catchup"; do
  legacy_plist="$HOME/Library/LaunchAgents/$legacy.plist"
  if [ -f "$legacy_plist" ]; then
    launchctl bootout "gui/$(id -u)/$legacy" 2>/dev/null || true
    rm -f "$legacy_plist"
    echo "Removed legacy plist: $legacy"
  fi
done

# ─── Scheduler tick plist (web-controlled schedule) ───────────
# Fires every 5 min. Reads schedule_settings from Supabase. If it's past the
# user-configured run_time today AND we haven't run yet today, fires the daily
# flow. The dashboard /settings/schedule UI is the only way to change run_time
# — no code edits, no plist regen needed when the schedule changes.

cat > "$TICK_PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$TICK_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_DIR/npx</string>
    <string>tsx</string>
    <string>$REPO_DIR/scripts/scheduler_tick.ts</string>
  </array>

  <!-- Tick every 5 min. Each tick is a tiny Supabase read + decision. -->
  <key>StartInterval</key>
  <integer>300</integer>

  <!-- Run once at load to pick up the schedule immediately -->
  <key>RunAtLoad</key>
  <true/>

  <key>AbandonProcessGroup</key>
  <false/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_DIR:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/scheduler-tick.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/scheduler-tick.err</string>
</dict>
</plist>
EOF

echo "Wrote $TICK_PLIST_PATH"

# ─── Manual jobs poller plist (Run Cycle Now button) ──────────
# Fires every 60s. Reads cycle_jobs from Supabase, claims any pending row,
# and spawns `npm run cycle` with the job's settings. The dashboard's
# "Run Cycle Now" button creates a cycle_jobs row; this poller picks it up
# within 60s when the Mac is on. Bypasses cycle_batches schedule entirely.

cat > "$JOBS_PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$JOBS_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_DIR/npx</string>
    <string>tsx</string>
    <string>$REPO_DIR/scripts/cycle_jobs_poller.ts</string>
  </array>

  <!-- Tick every 60s for fast button response. Each tick is a small read. -->
  <key>StartInterval</key>
  <integer>60</integer>

  <key>RunAtLoad</key>
  <true/>

  <key>AbandonProcessGroup</key>
  <false/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_DIR:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/jobs-poller.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/jobs-poller.err</string>
</dict>
</plist>
EOF

echo "Wrote $JOBS_PLIST_PATH"

# ─── Autoresearch plist (daily AI-driven brain) ───────────────
# Fires HOURLY plus on Mac wake-from-sleep. The script itself has a
# per-day guard (data/.last-autoresearch-run sentinel) so even though
# launchd may invoke it many times a day, the actual brain work runs
# at most once per calendar day. This means:
#   • If you turn the Mac on at 9 AM, the brain runs ~within an hour
#   • If you turn it on at 3 PM, the brain still runs once that day
#   • If you leave it on overnight, it runs at the first tick after midnight
#   • If the Mac is off all day, the brain runs the next time it boots
# No fixed time of day required — the Mac just needs to be on at
# some point in the day.

cat > "$AUTORESEARCH_PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$AUTORESEARCH_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_DIR/npx</string>
    <string>tsx</string>
    <string>$REPO_DIR/scripts/autoresearch.ts</string>
  </array>

  <!-- Tick once per hour. The script's own per-day guard ensures the
       brain only does real work once per calendar day, no matter how
       many times launchd invokes it. -->
  <key>StartInterval</key>
  <integer>3600</integer>

  <!-- Run on plist load too, so first-thing-in-the-morning starts and
       cold-boots cover the same-day case immediately. -->
  <key>RunAtLoad</key>
  <true/>

  <key>AbandonProcessGroup</key>
  <false/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_DIR:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/autoresearch.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/autoresearch.err</string>
</dict>
</plist>
EOF

echo "Wrote $AUTORESEARCH_PLIST_PATH"

# ─── Load it ─────────────────────────────────────────────────

# Note: the legacy 19:00 anti-thrash window is gone since we no longer have
# any StartCalendarInterval plist. The autoresearch plist fires at 08:30 but
# uses a much more forgiving cadence — re-bootstrapping near that window
# would just delay autoresearch by one cycle, not skip a whole posting day.
# Use the modern launchctl API (bootout/bootstrap). The deprecated load/unload
# does not always recompute calendar triggers correctly on macOS 13+.
DOMAIN="gui/$(id -u)"

for L in "$TICK_LABEL" "$JOBS_LABEL" "$AUTORESEARCH_LABEL"; do
  launchctl bootout "$DOMAIN/$L" 2>/dev/null || true
done

launchctl bootstrap "$DOMAIN" "$TICK_PLIST_PATH"
launchctl enable "$DOMAIN/$TICK_LABEL"
launchctl bootstrap "$DOMAIN" "$JOBS_PLIST_PATH"
launchctl enable "$DOMAIN/$JOBS_LABEL"
launchctl bootstrap "$DOMAIN" "$AUTORESEARCH_PLIST_PATH"
launchctl enable "$DOMAIN/$AUTORESEARCH_LABEL"

ok=1
for L in "$TICK_LABEL" "$JOBS_LABEL" "$AUTORESEARCH_LABEL"; do
  if launchctl print "$DOMAIN/$L" >/dev/null 2>&1; then
    echo "✓ Registered: $L"
  else
    echo "✗ launchctl did not register $L. Check syntax:"
    echo "  plutil -lint $HOME/Library/LaunchAgents/$L.plist"
    ok=0
  fi
done
[ "$ok" = "1" ] || exit 1

# ─── Summary ─────────────────────────────────────────────────

cat <<EOF

Setup complete.

  scheduler.tick   — every 5 min  — reads cycle_batches, fires due ones
  jobs.poller      — every 60 sec — picks up "Run Cycle Now" requests
  autoresearch     — every 1 hour + on-load — script self-guards to once/day

Useful commands:
  launchctl list | grep minutewise          # confirm 3 plists registered
  bash scripts/teardown_launchd.sh          # disable everything
  tail -f $LOG_DIR/scheduler-tick.log       # watch tick decisions
  tail -f $LOG_DIR/jobs-poller.log          # watch manual triggers
  tail -f $LOG_DIR/autoresearch.log         # watch the morning brain

To change schedule:
  Edit batches in the dashboard at /settings/schedule. No plist changes
  needed — the tick reads the dashboard each fire.

The Mac just needs to be on at some point each day. autoresearch runs
the first time the Mac is awake on a new calendar date; scheduled
batches fire whenever their time arrives within an awake window
(catch-up plays back missed runs on next wake).
EOF
