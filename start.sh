#!/bin/bash
set -e

echo ""
echo "  =========================================="
echo "   DevTracker - Starting up..."
echo "  =========================================="
echo ""

# Resolve script directory (like %~dp0)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Check Python ─────────────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
  echo "  [ERROR] Python3 not found."
  exit 1
fi

# ── Check Node ───────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "  [ERROR] Node.js not found."
  exit 1
fi

echo "  [OK] Python and Node.js found."
echo ""

# ── Install VS Code extension ────────────────────────────────
EXT_SRC="$ROOT/vscode-extension"
EXT_DST="$HOME/.vscode/extensions/devtracker-vscode"

if [ ! -d "$EXT_DST" ]; then
  echo "  [SETUP] Installing VS Code extension..."
  mkdir -p "$EXT_DST"
  cp -r "$EXT_SRC/"* "$EXT_DST/"
  echo "  [OK] VS Code extension installed."
else
  cp -r "$EXT_SRC/"* "$EXT_DST/"
  echo "  [OK] VS Code extension updated."
fi

echo ""

# ── Install dashboard deps (first time only) ─────────────────
if [ ! -d "$ROOT/dashboard/node_modules" ]; then
  echo "  [SETUP] Installing dashboard packages..."
  (cd "$ROOT/dashboard" && npm install --silent)
  echo "  [OK] Dashboard packages installed."
  echo ""
fi

# ── Start services ───────────────────────────────────────────
echo "  [START] Tracker..."
python3 "$ROOT/tracker/tracker.py" > "$ROOT/tracker.log" 2>&1 &

echo "  [START] API..."
python3 "$ROOT/tracker/api.py" > "$ROOT/api.log" 2>&1 &

echo "  [START] Dashboard..."
(cd "$ROOT/dashboard" && npm run dev > "$ROOT/dashboard.log" 2>&1 &) 

echo ""
echo "  [....] Waiting for dashboard to be ready..."

# ── Wait for dashboard ───────────────────────────────────────
until curl -s http://localhost:3000 >/dev/null; do
  sleep 2
done

echo "  [OK] Dashboard is ready!"
echo ""

# ── Open browser ─────────────────────────────────────────────
if command -v xdg-open >/dev/null; then
  xdg-open http://localhost:3000
elif command -v open >/dev/null; then
  open http://localhost:3000
fi

echo "  =========================================="
echo "   DevTracker is running!"
echo ""
echo "   Dashboard : http://localhost:3000"
echo "   API       : http://localhost:5050"
echo ""
echo "   Press Ctrl+C to stop."
echo "  =========================================="
echo ""

# ── Cleanup ─────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "  Stopping DevTracker..."
  kill -- -$$ 2>/dev/null
  echo "  Stopped. Data saved in devtracker.db"
  exit 0
}

trap cleanup INT TERM
wait
