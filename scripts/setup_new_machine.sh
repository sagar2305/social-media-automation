#!/bin/bash
#
# One-shot bootstrap for a fresh Mac.
#
# Usage:
#   1. Install prerequisites first (Homebrew + node + python3 + git):
#        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
#        brew install node python git
#        pip3 install Pillow
#
#   2. Clone the repo:
#        cd ~ && git clone https://github.com/sagar2305/social-media-automation.git
#        cd social-media-automation
#
#   3. Run this script:
#        bash scripts/setup_new_machine.sh
#
# This installs npm dependencies, prompts for API keys, runs a sanity check,
# and registers the launchd jobs. Idempotent — safe to re-run.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

green() { printf "\033[0;32m%s\033[0m\n" "$1"; }
red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
yellow(){ printf "\033[0;33m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

bold "═══ MinuteWise automation — new-machine bootstrap ═══"
echo

# ─── 1. Verify prerequisites ─────────────────────────────────
bold "[1/6] Checking prerequisites"
missing=0
for cmd in node npm python3 git; do
  if command -v "$cmd" >/dev/null 2>&1; then
    green "  ✓ $cmd ($($cmd --version 2>&1 | head -1))"
  else
    red   "  ✗ $cmd — not found. Install it (see SETUP.md step 1)."
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  red "Missing prerequisites — install them and re-run this script."
  exit 1
fi

if ! python3 -c "import PIL" 2>/dev/null; then
  yellow "  ⚠ Python Pillow not found — installing..."
  pip3 install Pillow
fi
echo

# ─── 2. npm install ──────────────────────────────────────────
bold "[2/6] Installing JavaScript dependencies"
npm install --silent
yellow "  installing dashboard deps..."
(cd dashboard && npm install --silent)
green "  ✓ dependencies installed"
echo

# ─── 3. Set up .env.local ────────────────────────────────────
bold "[3/6] Configuring API keys"
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  yellow "  Created .env.local — opening editor so you can paste keys."
  echo "  Required keys (get from 1Password / Bitwarden — not Slack):"
  echo "    VIRLO_API_KEY         (Virlo trends)"
  echo "    GEMINI_API_KEY        (image generation)"
  echo "    BLOTATO_API_KEY       (TikTok posting)"
  echo "    SCRAPECREATORS_API_KEY (TikTok metrics)"
  read -r -p "  Press ENTER to open the editor..."
  ${EDITOR:-open -e} .env.local
  read -r -p "  Done editing? Press ENTER to continue..."
else
  green "  ✓ .env.local already exists"
fi

if [ ! -f dashboard/.env.local ]; then
  red "  ✗ dashboard/.env.local missing. Copy from dashboard/.env.example and add SUPABASE_SERVICE_ROLE_KEY."
fi

# Sanity-check: are all four keys non-empty?
missing_keys=()
for key in VIRLO_API_KEY GEMINI_API_KEY BLOTATO_API_KEY SCRAPECREATORS_API_KEY; do
  val=$(grep -E "^${key}=" .env.local 2>/dev/null | cut -d'=' -f2-)
  if [ -z "$val" ] || [ "$val" = "" ]; then
    missing_keys+=("$key")
  fi
done
if [ "${#missing_keys[@]}" -gt 0 ]; then
  red "  ✗ Empty keys: ${missing_keys[*]}"
  red "    Edit .env.local and re-run this script."
  exit 1
fi
green "  ✓ all 4 API keys present"
echo

# ─── 4. Sanity check (live API call) ─────────────────────────
bold "[4/6] Sanity check — pinging Blotato + Gemini"
if npx tsx -e "
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });
const blotKey = process.env.BLOTATO_API_KEY!;
const gemKey  = process.env.GEMINI_API_KEY!;
async function main() {
  const blot = await fetch('https://backend.blotato.com/v2/users/me/accounts', {
    headers: { 'blotato-api-key': blotKey },
  });
  if (!blot.ok) throw new Error('Blotato auth failed: ' + blot.status);
  const accounts = (await blot.json()).items || [];
  console.log(\`  ✓ Blotato OK — \${accounts.length} accounts connected\`);

  const gem = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models?key=\${gemKey}\`);
  if (!gem.ok) throw new Error('Gemini auth failed: ' + gem.status);
  console.log('  ✓ Gemini OK');
}
main().catch(err => { console.error('  ✗ ' + err.message); process.exit(1); });
"; then
  green "  ✓ live APIs reachable"
else
  red "  ✗ live API check failed — verify the keys in .env.local"
  exit 1
fi
echo

# ─── 5. Install launchd jobs ─────────────────────────────────
bold "[5/6] Registering 7 PM scheduler"
bash scripts/setup_launchd.sh
echo

# ─── 6. Healthcheck ──────────────────────────────────────────
bold "[6/6] Final healthcheck"
bash scripts/healthcheck.sh || true
echo

green "═══ Setup complete ═══"
echo
echo "Next steps:"
echo "  • Open the TikTok app on both phones and confirm latest version."
echo "  • Wait until 7 PM IST today — first run will fire automatically."
echo "  • Watch progress with:    tail -f data/cycle-logs/launchd-daily.log"
echo "  • Status anytime with:    npm run healthcheck"
echo
