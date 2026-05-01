#!/usr/bin/env bash
# Kiosk mode: spin up the Pi server, the Next.js dev server, and Chromium
# fullscreen pointed at the photobooth. Ctrl+C cleans up all three.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"
PORT="${PHOTOBOOTH_NEXT_PORT:-3000}"

# Locate Chromium (different distros, different binary name).
CHROMIUM=""
for c in chromium-browser chromium google-chrome; do
  if command -v "$c" >/dev/null 2>&1; then
    CHROMIUM="$c"
    break
  fi
done
if [[ -z "$CHROMIUM" ]]; then
  echo "[kiosk] no chromium binary found — sudo apt install chromium-browser" >&2
  exit 1
fi

# Same python-picker as dev-all.sh.
if [[ -x "$SERVER_DIR/.venv/bin/python" ]]; then
  PY="$SERVER_DIR/.venv/bin/python"
else
  PY="$(command -v python3 || true)"
  if [[ -z "$PY" ]]; then
    echo "[kiosk] python3 not found." >&2
    exit 1
  fi
  echo "[kiosk] no server/.venv — using system python3."
fi

PI_PID=""
NEXT_PID=""
cleanup() {
  for pid in "$NEXT_PID" "$PI_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "[kiosk] starting pi server on :${PHOTOBOOTH_PORT:-8000}"
(
  cd "$SERVER_DIR"
  exec "$PY" app.py 2>&1 | sed -u 's/^/[pi] /'
) &
PI_PID=$!

sleep 1

echo "[kiosk] starting next.js on :$PORT"
(
  cd "$ROOT"
  PORT=$PORT exec npx next dev 2>&1 | sed -u 's/^/[next] /'
) &
NEXT_PID=$!

# Wait for Next to be reachable before launching the browser.
echo "[kiosk] waiting for http://localhost:$PORT ..."
for _ in $(seq 1 90); do
  if curl -sf "http://localhost:$PORT" -o /dev/null; then
    break
  fi
  sleep 1
done

echo "[kiosk] launching chromium"
"$CHROMIUM" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-translate \
  --no-first-run \
  --check-for-update-interval=31536000 \
  --disable-features=TranslateUI \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  "http://localhost:$PORT"
