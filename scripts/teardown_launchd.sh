#!/bin/bash
#
# Cleanly disables every launchd job set up by setup_launchd.sh.
# Removes the registration but leaves the .plist files on disk so re-enabling
# later is just `bash scripts/setup_launchd.sh` again.
#
# Run from anywhere on the Mac mini:
#   bash scripts/teardown_launchd.sh
#
# To completely delete the .plists too:
#   rm ~/Library/LaunchAgents/com.minutewise.*.plist

set -uo pipefail

# Modern label set (kept in lockstep with setup_launchd.sh).
LABELS=(
  "com.minutewise.scheduler.tick"
  "com.minutewise.jobs.poller"
  "com.minutewise.autoresearch"
  "com.minutewise.daily.refresh"
)

# Legacy labels we still try to clean up if a previous repo state left them
# loaded — harmless if they're already gone.
LEGACY_LABELS=(
  "com.minutewise.dailyflow"
  "com.minutewise.dailyflow.catchup"
)

DOMAIN="gui/$(id -u)"
unloaded=0
not_loaded=0
missing=0

unload_one() {
  local L="$1"
  local PLIST_PATH="$HOME/Library/LaunchAgents/$L.plist"

  if launchctl print "$DOMAIN/$L" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN/$L" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
    echo "✓ Unloaded $L"
    unloaded=$((unloaded + 1))
  elif [ -f "$PLIST_PATH" ]; then
    echo "·  $L  not currently loaded"
    not_loaded=$((not_loaded + 1))
  else
    missing=$((missing + 1))
  fi
}

echo "── Modern jobs ──"
for L in "${LABELS[@]}"; do unload_one "$L"; done

echo ""
echo "── Legacy cleanup ──"
for L in "${LEGACY_LABELS[@]}"; do unload_one "$L"; done

echo ""
echo "Summary: ${unloaded} unloaded, ${not_loaded} already inactive, ${missing} never installed."

cat <<EOF

The .plist files (if any) remain at:
  ~/Library/LaunchAgents/com.minutewise.*.plist

Re-enable everything with:
  bash scripts/setup_launchd.sh

Or delete entirely:
  rm ~/Library/LaunchAgents/com.minutewise.*.plist
EOF
