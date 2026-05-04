#!/bin/bash
#
# Cleanly disables the launchd job set up by setup_launchd.sh.
# Removes the registration but leaves the .plist on disk so re-enabling later
# is just `launchctl load <plist>`.
#
# Run from anywhere on the Mac mini:
#   bash scripts/teardown_launchd.sh
#
# To completely delete the .plist:
#   rm ~/Library/LaunchAgents/com.minutewise.dailyflow.plist

set -euo pipefail

LABEL="com.minutewise.dailyflow"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -f "$PLIST_PATH" ]; then
  echo "Nothing to disable: $PLIST_PATH does not exist."
  exit 0
fi

if launchctl list | grep -q "$LABEL"; then
  launchctl unload "$PLIST_PATH"
  echo "✓ Unloaded $LABEL — daily cycle is now disabled."
else
  echo "$LABEL was not currently loaded. Nothing to unload."
fi

cat <<EOF

The .plist is still at:
  $PLIST_PATH

Re-enable later with:
  launchctl load $PLIST_PATH

Or delete entirely:
  rm $PLIST_PATH
EOF
