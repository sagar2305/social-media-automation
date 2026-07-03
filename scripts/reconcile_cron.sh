#!/usr/bin/env bash
# Auto-reconcile transient post failures for all active campaigns.
# Runs on a schedule (launchd: com.minutewise.reconcile) every ~2.5h so the
# "Cannot read properties of undefined (reading 'status')" TikTok-side hiccups
# self-heal by re-posting from saved slides — no manual checking.
#
# max-age-hours is large (600h ≈ 25 days) on purpose: bulk-scheduled posts are
# GENERATED weeks before they publish, so a failure at publish time is already
# "old" by the archive's generation timestamp. 600h covers the July schedule
# while excluding truly ancient (>25d) abandoned failures.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

for camp in minutewise roastai; do
  echo "[$(date '+%F %T')] reconcile $camp ..."
  npx tsx scripts/reconcile_failed.ts --campaign="$camp" --path=direct --max-age-hours=600 || true
done
echo "[$(date '+%F %T')] reconcile cron done."
