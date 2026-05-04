#!/bin/bash
#
# Sanity-test launchd integration on the local Mac without burning real
# Gemini/Blotato credits. Registers a throwaway plist that only echoes a
# heartbeat to a log file, fires it once manually via `launchctl kickstart`,
# verifies the log line shows up, and tears everything down.
#
# Run:   bash scripts/test_launchd.sh

set -euo pipefail

LABEL="com.minutewise.test-$(date +%s)"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_FILE="/tmp/launchd-minutewise-test.log"

cleanup() {
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo ""
  echo "Cleaned up test plist."
}
trap cleanup EXIT

# Fresh log
rm -f "$LOG_FILE"
mkdir -p "$HOME/Library/LaunchAgents"

# ─── Generate a no-op test plist ─────────────────────────────

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
    <string>-c</string>
    <string>echo "launchd OK at \$(date)" &gt;&gt; "$LOG_FILE"</string>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
</dict>
</plist>
EOF

echo "1. Wrote throwaway plist: $PLIST_PATH"

# ─── Lint syntax ────────────────────────────────────────────

if ! plutil -lint "$PLIST_PATH" >/dev/null; then
  echo "✗ plist failed plutil syntax check"
  exit 1
fi
echo "2. plutil syntax check  → ✓"

# ─── Load it ────────────────────────────────────────────────

launchctl load "$PLIST_PATH"
if ! launchctl list | grep -q "$LABEL"; then
  echo "✗ launchctl did not register the job"
  exit 1
fi
echo "3. launchctl load + list → ✓"

# ─── Manually trigger one run (no need to wait for scheduled time) ─

# kickstart fires the job immediately, like the scheduled trigger would
launchctl kickstart "gui/$(id -u)/$LABEL"
echo "4. launchctl kickstart   → fired"

# Give it a beat to write
sleep 2

# ─── Verify the log line landed ─────────────────────────────

if [ -f "$LOG_FILE" ] && grep -q "launchd OK at" "$LOG_FILE"; then
  echo "5. Log line present     → ✓"
  echo ""
  echo "Log contents:"
  echo "─────────────────────────────"
  cat "$LOG_FILE"
  echo "─────────────────────────────"
else
  echo "✗ Log line not found at $LOG_FILE"
  echo "  This means launchd loaded the job but didn't fire it. Common causes:"
  echo "    - SIP / Full Disk Access missing for Terminal"
  echo "    - Path issues in the plist"
  exit 1
fi

echo ""
echo "✓ launchd is working correctly on this Mac."
echo "  The production setup_launchd.sh will work identically on the Mac mini."
echo "  The only difference: the production plist runs 'npm run flow' on a daily schedule"
echo "  instead of an echo on demand."
