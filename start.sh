#!/bin/bash
# start.sh — starts tracker + API + dashboard in one command
# Usage: bash start.sh
# Stop: Ctrl+C  (kills all three)

set -e

echo ""
echo "  🖥️  DevTracker"
echo "  ──────────────────────────────────"
echo ""

# ── Tracker ──────────────────────────────────────────────────────────────────
echo "  ▶  Tracker   → tracker/tracker.py"
python3 tracker/tracker.py > tracker.log 2>&1 &
TRACKER_PID=$!
echo "     PID: $TRACKER_PID   (logs: tracker.log)"

sleep 0.5

# ── API ───────────────────────────────────────────────────────────────────────
echo "  ▶  API       → http://localhost:5050"
python3 tracker/api.py > api.log 2>&1 &
API_PID=$!
echo "     PID: $API_PID   (logs: api.log)"

sleep 0.5

# ── Dashboard ─────────────────────────────────────────────────────────────────
echo "  ▶  Dashboard → http://localhost:3000"
cd dashboard && npm run dev > ../dashboard.log 2>&1 &
DASH_PID=$!
echo "     PID: $DASH_PID   (logs: dashboard.log)"

echo ""
echo "  ✅  All running.  Press Ctrl+C to stop everything."
echo ""

# ── Cleanup on Ctrl+C ─────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "  ⏹  Stopping all processes..."
  kill $TRACKER_PID $API_PID $DASH_PID 2>/dev/null
  wait $TRACKER_PID $API_PID $DASH_PID 2>/dev/null
  echo "  ✓  All stopped. Data saved to devtracker.db"
  exit 0
}

trap cleanup INT TERM
wait
