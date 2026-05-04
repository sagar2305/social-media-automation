#!/bin/bash
#
# Daily flow healthcheck. Single command to confirm the scheduler is healthy.
#
#   bash scripts/healthcheck.sh    OR    npm run healthcheck

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SENTINEL="$REPO_DIR/data/.last-daily-run"
LOG_FILE="$REPO_DIR/data/cycle-logs/launchd-daily.log"
DOMAIN="gui/$(id -u)"
LABELS=("com.minutewise.dailyflow" "com.minutewise.dailyflow.catchup")
TODAY="$(date +%Y-%m-%d)"

green() { printf "\033[0;32m%s\033[0m\n" "$1"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
yellow(){ printf "\033[0;33m%s\033[0m\n" "$1"; }

echo "═══ Daily Flow Healthcheck ═══"
echo ""

# 1. launchd registration
echo "── launchd services ──"
overall_ok=1
for L in "${LABELS[@]}"; do
  if launchctl print "$DOMAIN/$L" >/dev/null 2>&1; then
    runs=$(launchctl print "$DOMAIN/$L" 2>&1 | awk '/^\trun/ {print $NF; exit}')
    last_exit=$(launchctl print "$DOMAIN/$L" 2>&1 | awk '/last exit code/ {print $NF; exit}')
    state=$(launchctl print "$DOMAIN/$L" 2>&1 | awk '/^\tstate/ {print $NF; exit}')
    green "  ✓ $L  (state=$state runs=$runs last_exit=$last_exit)"
  else
    red   "  ✗ $L  NOT REGISTERED — run: bash scripts/setup_launchd.sh"
    overall_ok=0
  fi
done

# 2. Today's sentinel
echo ""
echo "── Today's run ──"
if [ -f "$SENTINEL" ]; then
  last=$(head -1 "$SENTINEL")
  ts=$(sed -n '2p' "$SENTINEL")
  caller=$(sed -n '3p' "$SENTINEL")
  if [ "$last" = "$TODAY" ]; then
    green "  ✓ Already ran today at $ts ($caller)"
  else
    yellow "  ⚠ Last run was $last, not today. Catch-up will fire after 19:00 if needed."
  fi
else
  yellow "  ⚠ No sentinel yet — will run on next 19:00 fire or hourly catch-up."
fi

# 3. Recent log tail
echo ""
echo "── Last 5 entries in launchd-daily.log ──"
if [ -f "$LOG_FILE" ]; then
  grep -E "^\[" "$LOG_FILE" 2>/dev/null | tail -5 | sed 's/^/  /'
else
  yellow "  ⚠ No log file yet"
fi

# 4. Queue status
echo ""
echo "── Unposted queue ──"
total=0
for f in flow1 flow2 flow3; do
  c=$(find "$REPO_DIR/posts/unposted/$f" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  total=$((total + c))
  echo "  unposted/$f: $c folders"
done
echo "  TOTAL: $total folders"

# 5. Result
echo ""
if [ "$overall_ok" = "1" ]; then
  green "═══ All checks passed ═══"
  exit 0
else
  red   "═══ Issues detected — see above ═══"
  exit 1
fi
