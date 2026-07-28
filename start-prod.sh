#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CBT Examination System - PRODUCTION Startup Script (macOS/Linux)
# ============================================================
# Builds the frontends and serves them as static production
# bundles (no Vite dev server, no Google Fonts, works on LAN
# and fully offline).
#
# Usage: ./start-prod.sh
# ============================================================

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/back-end"
ADMIN_DIR="$ROOT_DIR/admin-panel"
PORTAL_DIR="$ROOT_DIR/exam-portal"
PIDS=()

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

log()  { echo -e "${GREEN}[CBT]${NC} $1"; }
warn() { echo -e "${YELLOW}[CBT]${NC} $1"; }
err()  { echo -e "${RED}[CBT]${NC} $1"; }

# --- Cleanup on exit ---
cleanup() {
  echo ""
  warn "Shutting down all services..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  log "All services stopped."
}
trap cleanup EXIT INT TERM

# --- Detect LAN IP ---
LAN_IP=$(ifconfig 2>/dev/null | grep "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}')
if [ -z "$LAN_IP" ]; then
  LAN_IP="localhost"
fi

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  CBT Examination System - PRODUCTION   ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# ------------------------------------------------------------
# STEP 1: Clean up existing processes on our ports
# ------------------------------------------------------------
warn "[1/6] Cleaning up existing processes..."
for port in 3000 5173 5174; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    echo "  Freed port :$port"
  fi
done
sleep 1

# ------------------------------------------------------------
# STEP 2: Build Exam Portal
# ------------------------------------------------------------
warn "[2/6] Building Exam Portal..."
(cd "$PORTAL_DIR" && rm -rf dist && npx vite build --mode production) > /dev/null 2>&1
echo "  Exam Portal built."

# ------------------------------------------------------------
# STEP 3: Build Admin Panel
# ------------------------------------------------------------
warn "[3/6] Building Admin Panel..."
(cd "$ADMIN_DIR" && rm -rf dist && npx vite build --mode production) > /dev/null 2>&1
echo "  Admin Panel built."

# ------------------------------------------------------------
# STEP 4: Start Backend API
# ------------------------------------------------------------
log "[4/6] Starting Backend API (port 3000)..."
(cd "$BACKEND_DIR" && npx tsx src/index.ts) &
PIDS+=($!)
sleep 4

# Wait for backend
for i in $(seq 1 15); do
  if curl -s http://localhost:3000/health >/dev/null 2>&1; then
    log "  Backend is ready!"
    break
  fi
  sleep 1
done

# ------------------------------------------------------------
# STEP 5: Serve Exam Portal (production static + API proxy)
# ------------------------------------------------------------
log "[5/6] Serving Exam Portal (port 5174)..."
(cd "$PORTAL_DIR" && node serve.cjs) &
PIDS+=($!)
sleep 1

# ------------------------------------------------------------
# STEP 6: Serve Admin Panel (production static + API proxy)
# ------------------------------------------------------------
log "[6/6] Serving Admin Panel (port 5173)..."
(cd "$ADMIN_DIR" && node serve.cjs) &
PIDS+=($!)
sleep 1

# ------------------------------------------------------------
# Summary
# ------------------------------------------------------------
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  ALL SERVICES RUNNING (PRODUCTION)${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${WHITE}  EXAM PORTAL (candidates):${NC}"
echo -e "    Local:   http://localhost:5174/examportal"
echo -e "    LAN:     ${GREEN}http://${LAN_IP}:5174/examportal${NC}"
echo ""
echo -e "${WHITE}  ADMIN PANEL:${NC}"
echo -e "    Local:   http://localhost:5173"
echo -e "    LAN:     ${GREEN}http://${LAN_IP}:5173${NC}"
echo ""
echo -e "${WHITE}  BACKEND API:  http://localhost:3000${NC}"
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  LOGIN CREDENTIALS:${NC}"
echo -e "${CYAN}========================================${NC}"
echo -e "${WHITE}  Candidate:  ADM-001 / 01012000${NC}"
echo -e "${WHITE}  Admin:      admin@cbe.local / Admin@123${NC}"
echo ""
echo -e "${YELLOW}  Give candidates this URL:${NC}"
echo -e "${YELLOW}    http://${LAN_IP}:5174/examportal${NC}"
echo ""
echo -e "${CYAN}  PREREQUISITES (must be running):${NC}"
echo -e "${WHITE}    PostgreSQL:  localhost:5433${NC}"
echo -e "${WHITE}    Redis:       localhost:6379${NC}"
echo ""
log "Press Ctrl+C to stop all services."

# --- Wait for processes ---
wait
