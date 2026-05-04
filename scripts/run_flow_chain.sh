#!/bin/bash
# Chain 3 time-slotted cycles of flow1 + flow2:
#   slot 1 → posts immediately (direct)
#   slot 2 → Blotato-scheduled for +3h
#   slot 3 → Blotato-scheduled for +6h
# All 3 slots are generated on this machine back-to-back; posting is handled
# by Blotato's servers at the scheduled times (PC can go off after generation).
# Account rotation, the 3-accounts-per-24h cap, and the retry handler are all
# applied inside each cycle via main.ts — no extra logic needed here.

set -euo pipefail

mkdir -p data/cycle-logs
TS=$(date +%Y%m%d_%H%M%S)
NOW_EPOCH=$(date +%s)
T3H_MS=$(( (NOW_EPOCH + 3*3600) * 1000 ))
T6H_MS=$(( (NOW_EPOCH + 6*3600) * 1000 ))
LOG="data/cycle-logs/flow_chain_${TS}.log"

SLOT2_HUMAN=$(date -r $((T3H_MS/1000)))
SLOT3_HUMAN=$(date -r $((T6H_MS/1000)))

echo "╔═══════════════════════════════════════════════════╗"
echo "║  npm run flow — flow1 + flow2 × 3 time slots       "
echo "╠═══════════════════════════════════════════════════╣"
echo "║  Slot 1: post now (direct)                         "
echo "║  Slot 2: Blotato-schedule for ${SLOT2_HUMAN}"
echo "║  Slot 3: Blotato-schedule for ${SLOT3_HUMAN}"
echo "╚═══════════════════════════════════════════════════╝"
echo ""
echo "Log:  tail -f ${LOG}"
echo ""

nohup bash -c "
  echo '=== CHAIN START: '\$(date)
  # Slot 1 runs research (once per chain — refreshes TRENDING-NOW.md + HASHTAG-BANK.md).
  # Slots 2 & 3 reuse the same fresh data with --skip-research (no duplicate Virlo credits).
  echo '--- Slot 1: now (direct, flow 1 + 2, with research) ---'
  npm run cycle -- --flow=1,2 --posts-per-flow=2 --path=direct
  echo 'slot1 exit='\$?

  echo '--- Slot 2: scheduled for ${SLOT2_HUMAN} (reuses slot 1 research) ---'
  npm run cycle -- --flow=1,2 --posts-per-flow=2 --path=direct --skip-research --scheduledAt=${T3H_MS}
  echo 'slot2 exit='\$?

  echo '--- Slot 3: scheduled for ${SLOT3_HUMAN} (reuses slot 1 research) ---'
  npm run cycle -- --flow=1,2 --posts-per-flow=2 --path=direct --skip-research --scheduledAt=${T6H_MS}
  echo 'slot3 exit='\$?

  echo '=== CHAIN COMPLETE: '\$(date)
" > "${LOG}" 2>&1 &

CHAIN_PID=$!
echo "Chain PID: ${CHAIN_PID} (running detached — safe to close terminal)"
