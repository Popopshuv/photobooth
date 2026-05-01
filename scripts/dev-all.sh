#!/usr/bin/env bash
# Run the Pi camera/print server and the Next.js dev server together.
# Ctrl+C cleans up both. Output from the Python server is prefixed [pi].

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"

# Pick the Python interpreter. Prefer server/.venv if it was created with
# `python3 -m venv --system-site-packages .venv`, else fall back to system python3.
if [[ -x "$SERVER_DIR/.venv/bin/python" ]]; then
  PY="$SERVER_DIR/.venv/bin/python"
else
  PY="$(command -v python3 || true)"
  if [[ -z "$PY" ]]; then
    echo "[dev-all] python3 not found — install it or create server/.venv first." >&2
    exit 1
  fi
  echo "[dev-all] No server/.venv — using system python3. picamera2 must be installed via apt." >&2
fi

PI_PID=""
cleanup() {
  if [[ -n "$PI_PID" ]] && kill -0 "$PI_PID" 2>/dev/null; then
    kill "$PI_PID" 2>/dev/null || true
    wait "$PI_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[dev-all] starting pi server on :${PHOTOBOOTH_PORT:-8000}"
(
  cd "$SERVER_DIR"
  # Prefix every line of pi-server output with [pi] so it's easy to tell apart.
  exec "$PY" app.py 2>&1 | sed -u 's/^/[pi] /'
) &
PI_PID=$!

# Give the Pi server a moment to bind before Next starts pointing at it.
sleep 1

echo "[dev-all] starting next dev"
exec npx next dev
