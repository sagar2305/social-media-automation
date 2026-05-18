#!/bin/bash
#
# Pipeline healthcheck. One command to confirm every moving part is alive.
#
#   bash scripts/healthcheck.sh    OR    npm run healthcheck
#
# Exit code 0 = everything green; 1 = at least one issue.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_DIR/data/cycle-logs"
DOMAIN="gui/$(id -u)"

LABELS=(
  "com.minutewise.scheduler.tick"
  "com.minutewise.jobs.poller"
  "com.minutewise.autoresearch"
  "com.minutewise.daily.refresh"
)

green() { printf "\033[0;32m%s\033[0m\n" "$1"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
yellow(){ printf "\033[0;33m%s\033[0m\n" "$1"; }

echo "═══ Pipeline Healthcheck ═══"
echo ""

overall_ok=1

# 1. launchd registration + state for all four modern plists
echo "── launchd services ──"
for L in "${LABELS[@]}"; do
  if launchctl print "$DOMAIN/$L" >/dev/null 2>&1; then
    info=$(launchctl print "$DOMAIN/$L" 2>&1)
    runs=$(echo "$info" | awk '/^\trun/ {print $NF; exit}')
    state=$(echo "$info" | awk '/^\tstate/ {print $NF; exit}')
    # last exit code can be "0", a negative number, or "(never exited)" when
    # the job hasn't completed a run yet. Capture the full RHS, not just $NF.
    last_exit=$(echo "$info" | awk -F' = ' '/last exit code/ {print $2; exit}')
    if [ "$last_exit" = "0" ] || [ -z "$last_exit" ] || [ "$last_exit" = "(never exited)" ]; then
      green "  ✓ $L  (state=$state runs=$runs last_exit=${last_exit:-n/a})"
    else
      red   "  ✗ $L  (state=$state runs=$runs last_exit=$last_exit) — last run failed"
      overall_ok=0
    fi
  else
    red   "  ✗ $L  NOT REGISTERED — run: bash scripts/setup_launchd.sh"
    overall_ok=0
  fi
done

# 2. Daily-refresh freshness — should be < 8h old (we run every 6h, allow slack)
echo ""
echo "── Daily refresh freshness ──"
REFRESH_LOG="$REPO_DIR/data/REFRESH-LOG.md"
if [ -f "$REFRESH_LOG" ]; then
  mtime=$(stat -f %m "$REFRESH_LOG" 2>/dev/null || echo 0)
  now=$(date +%s)
  age_h=$(( (now - mtime) / 3600 ))
  if [ "$age_h" -lt 8 ]; then
    green "  ✓ REFRESH-LOG.md updated ${age_h}h ago"
  elif [ "$age_h" -lt 36 ]; then
    yellow "  ⚠ REFRESH-LOG.md is ${age_h}h old — borderline"
  else
    red   "  ✗ REFRESH-LOG.md is ${age_h}h old — daily.refresh likely broken. Tail $LOG_DIR/daily-refresh.err"
    overall_ok=0
  fi
else
  yellow "  ⚠ No REFRESH-LOG.md yet — first run hasn't completed"
fi

# 3. Recent err log noise — anything substantial indicates a silent fault.
echo ""
echo "── Stderr log noise ──"
for err_file in scheduler-tick.err jobs-poller.err autoresearch.err daily-refresh.err; do
  full="$LOG_DIR/$err_file"
  if [ -f "$full" ]; then
    size=$(wc -c <"$full" | tr -d ' ')
    lines=$(wc -l <"$full" | tr -d ' ')
    if [ "$size" = "0" ]; then
      green "  ✓ $err_file  (empty)"
    elif [ "$lines" -lt 5 ]; then
      yellow "  ⚠ $err_file  ($lines lines, $size bytes) — review"
    else
      red   "  ✗ $err_file  ($lines lines, $size bytes) — pipeline degrading silently"
      tail -3 "$full" | sed 's/^/      /'
      overall_ok=0
    fi
  fi
done

# 4. Disk pressure — posts/ accumulates Gemini outputs (~1.5 MB per slide)
echo ""
echo "── Disk usage ──"
posts_size=$(du -sh "$REPO_DIR/posts" 2>/dev/null | awk '{print $1}')
posts_mb=$(du -sm "$REPO_DIR/posts" 2>/dev/null | awk '{print $1}')
if [ -n "$posts_mb" ] && [ "$posts_mb" -lt 500 ]; then
  green "  ✓ posts/ uses $posts_size"
elif [ -n "$posts_mb" ] && [ "$posts_mb" -lt 2000 ]; then
  yellow "  ⚠ posts/ uses $posts_size — consider: npm run cleanup:posts"
else
  red   "  ✗ posts/ uses $posts_size — disk-fill risk. Run: npm run cleanup:posts"
  overall_ok=0
fi

# 5. Slack alerting configured?
echo ""
echo "── Alert channel ──"
if [ -f "$REPO_DIR/.env.local" ] && grep -q "^SLACK_ALERT_WEBHOOK=" "$REPO_DIR/.env.local"; then
  green "  ✓ SLACK_ALERT_WEBHOOK configured (real-time alerts active)"
else
  yellow "  ⚠ SLACK_ALERT_WEBHOOK not set — alerts only land in data/auto-fix-alerts.md (file-only fallback)"
fi

# 6. Result
echo ""
if [ "$overall_ok" = "1" ]; then
  green "═══ All checks passed ═══"
  exit 0
else
  red   "═══ Issues detected — see above ═══"
  exit 1
fi
