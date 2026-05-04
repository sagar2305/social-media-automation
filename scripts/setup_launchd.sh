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

LABEL="com.minutewise.dailyflow"
CATCHUP_LABEL="com.minutewise.dailyflow.catchup"
TICK_LABEL="com.minutewise.scheduler.tick"
JOBS_LABEL="com.minutewise.jobs.poller"
AUTORESEARCH_LABEL="com.minutewise.autoresearch"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
CATCHUP_PLIST_PATH="$HOME/Library/LaunchAgents/$CATCHUP_LABEL.plist"
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

# ─── Generate plist ──────────────────────────────────────────

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/daily_runner.sh</string>
    <string>primary</string>
  </array>

  <!-- Run every day at 19:00 local time. Adjust below if needed. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>19</integer>
    <key>Minute</key><integer>0</integer>
  </dict>

  <!-- Don't fire when launchd loads the plist; only on the schedule -->
  <key>RunAtLoad</key>
  <false/>

  <!-- Skip if a previous run is still going (rare, but safe) -->
  <key>AbandonProcessGroup</key>
  <false/>

  <!-- Inherit a sensible PATH so npm/tsx/git resolve -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODE_DIR:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>

  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>

  <key>StandardErrorPath</key>
  <string>$ERR_FILE</string>
</dict>
</plist>
EOF

echo "Wrote $PLIST_PATH"

# ─── Catch-up plist (hourly, kicks in if 19:00 was missed) ────

cat > "$CATCHUP_PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$CATCHUP_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/daily_runner.sh</string>
    <string>catchup</string>
  </array>

  <!-- Fire every hour. The runner is idempotent (sentinel-guarded) and only
       takes action after 19:00 local if today's primary run is missing. -->
  <key>StartInterval</key>
  <integer>3600</integer>

  <!-- Run once at load too, in case 19:00 was missed before the laptop woke up -->
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
  <string>$LOG_FILE</string>

  <key>StandardErrorPath</key>
  <string>$ERR_FILE</string>
</dict>
</plist>
EOF

echo "Wrote $CATCHUP_PLIST_PATH"

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

# ─── Autoresearch plist (daily AI-driven experiment design) ───
# Fires once per day at 08:30 local. Replaces the Claude /loop pattern with
# a Node script that calls Gemini to pick the next experiment, then queues
# the two variants as cycle_jobs. The system needs no Claude Code to keep
# improving its content over time.

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

  <!-- Daily at 08:30 local. Far enough from posting times to avoid contention. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>8</integer>
    <key>Minute</key><integer>30</integer>
  </dict>

  <key>RunAtLoad</key>
  <false/>

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

# Refuse to (re)load near the scheduled fire time — launchd's anti-thrash logic
# can drop the next occurrence if a calendar-interval agent is bootstrapped
# within minutes of its trigger.
CURRENT_HM="$(date +%H%M)"
if [ "$CURRENT_HM" -ge 1845 ] && [ "$CURRENT_HM" -lt 1930 ]; then
  echo "✗ Refusing to reload between 18:45 and 19:30 — too close to 19:00 fire."
  echo "  Re-run this script before 18:45 or after 19:30 to avoid skipping today's run."
  exit 1
fi

# Use the modern launchctl API (bootout/bootstrap). The deprecated load/unload
# does not always recompute calendar triggers correctly on macOS 13+.
DOMAIN="gui/$(id -u)"

for L in "$LABEL" "$CATCHUP_LABEL" "$TICK_LABEL" "$JOBS_LABEL" "$AUTORESEARCH_LABEL"; do
  launchctl bootout "$DOMAIN/$L" 2>/dev/null || true
done

launchctl bootstrap "$DOMAIN" "$PLIST_PATH"
launchctl enable "$DOMAIN/$LABEL"
launchctl bootstrap "$DOMAIN" "$CATCHUP_PLIST_PATH"
launchctl enable "$DOMAIN/$CATCHUP_LABEL"
launchctl bootstrap "$DOMAIN" "$TICK_PLIST_PATH"
launchctl enable "$DOMAIN/$TICK_LABEL"
launchctl bootstrap "$DOMAIN" "$JOBS_PLIST_PATH"
launchctl enable "$DOMAIN/$JOBS_LABEL"
launchctl bootstrap "$DOMAIN" "$AUTORESEARCH_PLIST_PATH"
launchctl enable "$DOMAIN/$AUTORESEARCH_LABEL"

ok=1
for L in "$LABEL" "$CATCHUP_LABEL" "$TICK_LABEL" "$JOBS_LABEL" "$AUTORESEARCH_LABEL"; do
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

  Schedule:   Daily at 19:00 local time
  Command:    cd $REPO_DIR && npx tsx scripts/repost_unposted_6.ts ; npm run refresh
  Stdout:     $LOG_FILE
  Stderr:     $ERR_FILE

Useful commands:
  launchctl list | grep minutewise              # confirm registered
  launchctl unload "$PLIST_PATH"                 # disable
  launchctl load   "$PLIST_PATH"                 # re-enable
  tail -f "$LOG_FILE"                            # watch live next run

To change the schedule, edit StartCalendarInterval in:
  $PLIST_PATH
…then unload + load again.

What happens at 19:00 each day:
  STAGE 1 — Repost cycle (scripts/repost_unposted_6.ts)
    - Scans posts/unposted/{flow1,flow2}
    - Picks newest 3 archives per healthy account (yournotetaker, miniutewise_thomas)
    - Slot 1 posts go live ~19:00 (direct)
    - Slot 2 scheduled via Blotato for 22:00 (+3h, server-side)
    - Slot 3 scheduled via Blotato for 01:00 next day (+6h, server-side)
    - Posted folders move from posts/unposted/ → posts/ with .submitted marker
  STAGE 2 — Refresh cycle (npm run refresh)
    - Tier scheduler fires whatever is due:
        hot     (page 1)        — daily
        warm    (pages 2-3)     — every 3 days
        cool    (pages 4-9)     — weekly
        archive (pages 10-12)   — weekly (only if posts ≥30 days old exist)
        stats   (/v1/profile)   — weekly
    - Runs optimizer over fresh metrics (winners/losers, format rankings)
    - Refreshes Virlo trends + hashtag bank
    - Syncs everything to Supabase so the dashboard updates
  Mac mini just needs to be awake at 19:00.
EOF
