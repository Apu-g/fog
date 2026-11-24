#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install Node.js, then run ./start.sh" >&2
  exit 1
fi
exec node start.js
