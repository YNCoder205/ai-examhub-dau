#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/backend/api"
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev &

cd "$ROOT_DIR/frontend/web"
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev -- --host 0.0.0.0
