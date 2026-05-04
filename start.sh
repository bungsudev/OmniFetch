#!/bin/bash

# ⚡ OmniFetch Pro — Start Script
# ================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ⚡ OmniFetch Pro${NC}"
echo -e "${CYAN}  ════════════════════════════════════${NC}"
echo ""

# ── Step 1: Check PostgreSQL ──────────────────────────────────────────

echo -e "${BLUE}[1/4]${NC} Checking PostgreSQL..."

if command -v pg_isready &> /dev/null; then
  if pg_isready -q 2>/dev/null; then
    echo -e "  ${GREEN}✔${NC} PostgreSQL is running"
  else
    echo -e "  ${YELLOW}⏳${NC} Starting PostgreSQL..."
    if command -v brew &> /dev/null; then
      brew services start postgresql@14 2>/dev/null || brew services start postgresql 2>/dev/null
      sleep 2
      if pg_isready -q 2>/dev/null; then
        echo -e "  ${GREEN}✔${NC} PostgreSQL started successfully"
      else
        echo -e "  ${RED}✘${NC} Failed to start PostgreSQL"
        echo -e "  ${YELLOW}Tip:${NC} Try running 'brew services start postgresql' manually"
        exit 1
      fi
    else
      echo -e "  ${RED}✘${NC} PostgreSQL is not running and brew not found"
      echo -e "  ${YELLOW}Tip:${NC} Start PostgreSQL manually, then re-run this script"
      exit 1
    fi
  fi
else
  echo -e "  ${YELLOW}⚠${NC}  pg_isready not found, skipping PostgreSQL check"
  echo -e "  ${YELLOW}Tip:${NC} Make sure PostgreSQL is running before continuing"
fi

# ── Step 2: Create database (if not exists) ───────────────────────────

echo -e "${BLUE}[2/4]${NC} Checking database..."

if command -v createdb &> /dev/null; then
  createdb http_tracker 2>/dev/null && echo -e "  ${GREEN}✔${NC} Database 'http_tracker' created" \
    || echo -e "  ${GREEN}✔${NC} Database 'http_tracker' already exists"
else
  echo -e "  ${YELLOW}⚠${NC}  createdb not found, skipping"
fi

# ── Step 3: Install dependencies ─────────────────────────────────────

echo -e "${BLUE}[3/4]${NC} Installing dependencies..."

if [ ! -d "$SERVER_DIR/node_modules" ]; then
  cd "$SERVER_DIR"
  npm install --silent
  echo -e "  ${GREEN}✔${NC} Dependencies installed"
else
  echo -e "  ${GREEN}✔${NC} Dependencies already installed"
fi

# ── Step 4: Start server ─────────────────────────────────────────────

echo ""
echo -e "${BLUE}[4/4]${NC} Starting OmniFetch server..."
echo ""
echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}🌐 Admin Panel:${NC}  http://localhost:3847"
echo -e "  ${BOLD}📡 API Base:${NC}     http://localhost:3847/api"
echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${YELLOW}📌 Chrome Extension:${NC}"
echo -e "     chrome://extensions/ → Load unpacked → select ${BOLD}extension/${NC} folder"
echo ""
echo -e "  ${GREEN}Press Ctrl+C to stop the server${NC}"
echo ""

cd "$SERVER_DIR"
node server.js
