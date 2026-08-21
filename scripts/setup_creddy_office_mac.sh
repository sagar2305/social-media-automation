#!/bin/bash

# Safe, idempotent bootstrap for the Creddy automation on an office Mac.
# This script installs and verifies local dependencies. It deliberately does
# not enable the pipeline, create a scheduler, or contact publishing endpoints.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_SOURCE=""
DATA_ROOT=""
SKIP_INSTALL=0

usage() {
  cat <<'EOF'
Usage:
  bash scripts/setup_creddy_office_mac.sh \
    --data-source "/path/to/transferred/Social media automation data" \
    --data-root "/Users/<office-user>/Documents/ChatGPT/Social media automation data"

Options:
  --data-source PATH  Existing transferred data directory to copy (optional).
  --data-root PATH    New durable data location on this Mac (required with --data-source).
  --skip-install      Skip npm dependency installation.
  --help              Show this help.

Safety:
  - Refuses to overwrite a non-empty data destination.
  - Never copies, prints, or requests API-key values.
  - Never enables Creddy publishing or submits content externally.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --data-source)
      [ "$#" -ge 2 ] || { echo "ERROR: --data-source needs a path" >&2; exit 2; }
      DATA_SOURCE="$2"
      shift 2
      ;;
    --data-root)
      [ "$#" -ge 2 ] || { echo "ERROR: --data-root needs a path" >&2; exit 2; }
      DATA_ROOT="$2"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: this bootstrap is intended for macOS." >&2
  exit 1
fi

echo "== Creddy office Mac bootstrap =="
echo "Repository: $REPO_DIR"

missing=0
for command_name in git node npm python3 cloudflared; do
  if command -v "$command_name" >/dev/null 2>&1; then
    echo "OK: $command_name"
  else
    echo "MISSING: $command_name" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  echo "Install the missing prerequisites, then run this script again." >&2
  exit 1
fi

if [ -n "$DATA_SOURCE" ] || [ -n "$DATA_ROOT" ]; then
  if [ -z "$DATA_SOURCE" ] || [ -z "$DATA_ROOT" ]; then
    echo "ERROR: --data-source and --data-root must be supplied together." >&2
    exit 2
  fi
  if [ ! -d "$DATA_SOURCE" ] || [ -L "$DATA_SOURCE" ]; then
    echo "ERROR: data source must be a real directory, not a symbolic link: $DATA_SOURCE" >&2
    exit 1
  fi
  if [ "$DATA_SOURCE" = "$DATA_ROOT" ]; then
    echo "ERROR: data source and destination are the same directory." >&2
    exit 1
  fi
  if [ -e "$DATA_ROOT" ]; then
    if [ ! -d "$DATA_ROOT" ] || [ -L "$DATA_ROOT" ]; then
      echo "ERROR: data destination is not a normal directory: $DATA_ROOT" >&2
      exit 1
    fi
    if [ -n "$(find "$DATA_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
      echo "ERROR: refusing to overwrite non-empty data destination: $DATA_ROOT" >&2
      exit 1
    fi
  else
    mkdir -p "$DATA_ROOT"
  fi
  echo "Copying durable Creddy data to: $DATA_ROOT"
  ditto "$DATA_SOURCE" "$DATA_ROOT"
  echo "OK: data copied"
fi

cd "$REPO_DIR"
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  chmod 600 .env.local
  echo "CREATED: $REPO_DIR/.env.local (fill values locally from the approved secret manager)"
else
  chmod 600 .env.local
  echo "OK: root .env.local exists"
fi

if [ ! -f dashboard/.env.local ]; then
  cp dashboard/.env.example dashboard/.env.local
  chmod 600 dashboard/.env.local
  echo "CREATED: $REPO_DIR/dashboard/.env.local (fill values locally from the approved secret manager)"
else
  chmod 600 dashboard/.env.local
  echo "OK: dashboard/.env.local exists"
fi

if [ "$SKIP_INSTALL" -eq 0 ]; then
  echo "Installing root dependencies..."
  npm ci
  echo "Installing dashboard dependencies..."
  (cd dashboard && npm ci)
fi

echo "Validating Creddy configuration..."
npm run creddy:validate

echo "Running Creddy tests..."
npm run creddy:test

echo "Validating production deployment settings..."
npm run creddy:deploy:validate

echo "Building the dashboard..."
(cd dashboard && npx next build --webpack)

cat <<EOF

Bootstrap checks completed.

Still required before activation:
  1. Fill both .env.local files locally; never paste secrets into chat.
  2. Set CREDDY_DATA_ROOT to: ${DATA_ROOT:-<office Mac durable data path>}
  3. Keep CREDDY_PIPELINE_ENABLED=false for the supervised dry run.
  4. Start Video Factory if the selected rendering flow requires it.
  5. Configure the named Cloudflare Tunnel and stable public hostname.
  6. Start the dashboard and verify it at http://127.0.0.1:3000.
  7. Run npm run creddy:deploy:validate -- --live.
  8. Create exactly one Codex scheduled orchestrator only after dry-run approval.

No content was posted, scheduled, or sent to drafts by this script.
EOF
