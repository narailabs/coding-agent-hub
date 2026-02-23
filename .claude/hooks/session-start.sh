#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote (web) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "Installing dependencies..." >&2
pnpm install

echo "Building project..." >&2
pnpm build

echo "Session startup complete." >&2
