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

# Mutex: reconcile_failed.ts only marks a row 'retried' AFTER a successful
# re-post, so two overlapping runs could both claim the same failure and post
# it twice. mkdir is atomic — if the lock exists, another run is active, skip.
LOCK_DIR="${TMPDIR:-/tmp}/minutewise-reconcile.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(date '+%F %T')] another reconcile run is active ($LOCK_DIR) — skipping."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

for camp in minutewise roastai; do
  echo "[$(date '+%F %T')] reconcile $camp ..."
  npx tsx scripts/reconcile_failed.ts --campaign="$camp" --path=direct --max-age-hours=600 || true
done
echo "[$(date '+%F %T')] reconcile cron done."
