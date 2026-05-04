#!/bin/bash
#
# Idempotent daily flow runner.
#
# Stages (all batches submitted to Blotato in one ~15min window at 19:00,
# then laptop is free to sleep — Blotato handles scheduled publish times):
#   Batch 1  19:00 IST — direct, photorealistic  × 2 accounts = 2 posts (PUBLISH NOW)
#   Batch 2  19:00 IST — draft,  animated        × 2 accounts = 2 drafts in TikTok app
#                                                  (publish manually around 22:00 — drafts can't be scheduled)
#   Batch 3  01:00 IST — direct, emoji_overlay   × 2 accounts = 2 posts (Blotato schedules +6h)
#   Refresh            — analytics + optimizer (refresh:quick, no Virlo —
#                         batch 1 already pulled fresh trends)
#
# Active accounts: @yournotetaker + @miniutewise_thomas
# Each batch has a per-day sentinel (data/.batchN-done-YYYY-MM-DD) so a
# crashed/restarted runner skips already-done batches and never double-posts.
#
# Invoked by two launchd jobs:
#   1. com.minutewise.dailyflow         — fires at 19:00 each day (primary)
#   2. com.minutewise.dailyflow.catchup — fires hourly when awake (safety net)
#
# Both call this script. The first to run today writes a sentinel file with
# today's date; subsequent calls within the same day exit immediately. This
# means the catch-up job runs the daily flow late if 19:00 was missed (system
# was asleep, plist was reloaded near fire time, etc.) but never duplicates a
# successful run.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SENTINEL="$REPO_DIR/data/.last-daily-run"
LOCK_DIR="$REPO_DIR/data/.daily-runner.lock"
LOG_DIR="$REPO_DIR/data/cycle-logs"
LOG_FILE="$LOG_DIR/launchd-daily.log"
TODAY="$(date +%Y-%m-%d)"
NOW="$(date +%H%M)"

mkdir -p "$LOG_DIR"

ts() { date "+[%Y-%m-%d %H:%M:%S]"; }
say() { echo "$(ts) $*" >> "$LOG_FILE"; }

# ─── Idempotency check ───────────────────────────────────────

if [ -f "$SENTINEL" ]; then
  LAST_RUN="$(head -1 "$SENTINEL" 2>/dev/null || echo "")"
  if [ "$LAST_RUN" = "$TODAY" ]; then
    # Already ran today — silent exit (catch-up firings are expected to no-op)
    exit 0
  fi
fi

# ─── Catch-up jobs only run AFTER 19:00 ──────────────────────
# The primary job fires at 19:00 sharp. The catch-up fires every hour. We only
# want catch-up to take action if 19:00 has already passed today AND the
# primary missed (no sentinel for today). Before 19:00, exit silently.

CALLER="${1:-primary}"
if [ "$CALLER" = "catchup" ] && [ "$NOW" -lt 1900 ]; then
  exit 0
fi

# ─── Mutex: serialise concurrent firings ─────────────────────
# The sentinel check above is per-day, not per-process. If primary (19:00) and
# catchup (20:00) overlap — or two operators trigger by hand — both can pass
# the sentinel check before either writes it, leading to two posters racing
# over the same `posts/unposted/.../*.png` folder (file gets deleted by run A
# while run B is still uploading it → ENOENT).
#
# `mkdir` is atomic on POSIX, so use it as a lock. Stale locks (process died
# without cleanup) are detected by checking the PID file inside.

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_DIR/pid"
    return 0
  fi
  # Lock exists — check if the holder is alive
  local holder=""
  holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    return 1  # live holder, abort
  fi
  # Stale lock — reclaim it
  say "⚠ stale lock from PID $holder, reclaiming"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || return 1
  echo "$$" > "$LOCK_DIR/pid"
  return 0
}

if ! acquire_lock; then
  say "⊘ another daily_runner is already active (lock held) — caller=$CALLER exiting"
  exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

# ─── Run the daily flow ──────────────────────────────────────

say "═══════════════════════════════════════════════════════"
say "DAILY FLOW START — caller=$CALLER"
say "═══════════════════════════════════════════════════════"

cd "$REPO_DIR" || { say "FATAL: cannot cd to $REPO_DIR"; exit 1; }

# Active accounts come from the dashboard-managed Supabase `accounts` table
# (loaded via scripts/account_loader.ts). The CLI prints a comma-separated
# list of handles where active=true. If the loader fails (DB down, etc.) it
# falls back to config.ts and emits the full set there. The DAILY_ACCOUNTS
# env var, if set, overrides everything (escape hatch for manual reruns).

if [ -n "${DAILY_ACCOUNTS:-}" ]; then
  ACTIVE_ACCOUNTS="$DAILY_ACCOUNTS"
else
  ACTIVE_ACCOUNTS="$(npx tsx scripts/account_loader.ts handles 2>/dev/null | tail -1)"
  if [ -z "$ACTIVE_ACCOUNTS" ]; then
    say "✗ FATAL: account loader returned empty list — exiting"
    exit 1
  fi
fi
say "── Active accounts: $ACTIVE_ACCOUNTS ──"

# Pre-compute publish times in UTC ISO 8601. Launchd fires at 19:00 IST
# (= 13:30 UTC), so +3h → 22:00 IST and +6h → 01:00 IST next day.
SCHEDULE_T2="$(date -u -v+3H "+%Y-%m-%dT%H:%M:%SZ")"
SCHEDULE_T3="$(date -u -v+6H "+%Y-%m-%dT%H:%M:%SZ")"

# ─── Per-batch helper ────────────────────────────────────────
# Each batch posts 1 flow × 2 accounts = 2 posts. A per-day sentinel
# `data/.batchN-done-YYYY-MM-DD` makes the batch idempotent — if the runner
# crashes and the catchup re-fires, completed batches are skipped, never
# re-posted. The 5th arg is an optional ISO 8601 time passed to Blotato as
# scheduledTime — empty string means publish immediately.

do_batch() {
  local n="$1" path="$2" flow="$3" label="$4" scheduled_at="$5" skip_research="$6"
  local sentinel_file="$REPO_DIR/data/.batch${n}-done-${TODAY}"
  if [ -f "$sentinel_file" ]; then
    say "⊘ Batch ${n} already done today — skipping"
    return 0
  fi
  say "── Batch ${n}: ${label} (path=${path}, flow=${flow}${scheduled_at:+, publish=$scheduled_at}${skip_research:+, --skip-research}) ──"
  local args=(--path="$path" --flow="$flow" --account="$ACTIVE_ACCOUNTS")
  [ -n "$scheduled_at" ]  && args+=(--scheduledAt="$scheduled_at")
  [ -n "$skip_research" ] && args+=(--skip-research)
  npm run cycle -- "${args[@]}" >> "$LOG_FILE" 2>&1
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    touch "$sentinel_file"
    say "✓ Batch ${n} done"
  else
    say "✗ Batch ${n} failed (exit=$rc)"
  fi
  return $rc
}

# ─── Run all 3 batches back-to-back (Blotato schedules the future ones) ───
# Virlo credit budget: only batch 1 fetches fresh trends. Batches 2 & 3 reuse
# the trend file written by batch 1 (trends don't shift in 15 minutes), and
# the refresh stage uses refresh:quick to skip the redundant Virlo call too.
# Net Virlo calls per night: 1 (was 4).

RC1=0; RC2=0; RC3=0; REFRESH_RC=0

do_batch 1 direct 1 "DIRECT — photorealistic (publish now)" "" ""
RC1=$?

do_batch 2 draft 2 "DRAFT — animated (drafts saved to TikTok at 19:00; you publish manually around 22:00)" "" "1"
RC2=$?

do_batch 3 direct 3 "DIRECT — emoji_overlay (publish at 01:00 IST)" "$SCHEDULE_T3" "1"
RC3=$?

# ─── Refresh runs once after all batches ─────────────────────

say "── Stage 2: npm run refresh:quick (no Virlo — trends already pulled in batch 1) ──"
npm run refresh:quick >> "$LOG_FILE" 2>&1
REFRESH_RC=$?
if [ "$REFRESH_RC" -ne 0 ]; then
  say "✗ refresh stage failed (exit=$REFRESH_RC)"
fi

# ─── Sentinel + alert ────────────────────────────────────────

if [ "$RC1" -eq 0 ] && [ "$RC2" -eq 0 ] && [ "$RC3" -eq 0 ] && [ "$REFRESH_RC" -eq 0 ]; then
  printf '%s\n' "$TODAY" "$(date -Iseconds)" "caller=$CALLER" > "$SENTINEL"
  say "✓ DAILY FLOW COMPLETE — sentinel written"
  exit 0
fi

# Failure path — write a failure marker (NOT today's date) so catch-up retries
say "✗ DAILY FLOW FAILED — batch1=$RC1 batch2=$RC2 batch3=$RC3 refresh=$REFRESH_RC"

if [ -n "${SLACK_ALERT_WEBHOOK:-}" ]; then
  curl -fsS -X POST "$SLACK_ALERT_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\":rotating_light: Daily flow failed on $TODAY (b1=$RC1 b2=$RC2 b3=$RC3 refresh=$REFRESH_RC). Check $LOG_FILE\"}" \
    > /dev/null 2>&1 || true
fi

exit 1
