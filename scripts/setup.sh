#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Spore setup
# ---------------------------------------------------------------------------

BOLD="\033[1m"
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
RESET="\033[0m"

header() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}║           Spore setup                ║${RESET}"
  echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
  echo ""
}

info()    { echo -e "  ${BOLD}→${RESET} $*"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}!${RESET} $*"; }
error()   { echo -e "  ${RED}✗ ERROR:${RESET} $*" >&2; }

# ---------------------------------------------------------------------------
# 1. Header
# ---------------------------------------------------------------------------
header

# ---------------------------------------------------------------------------
# 2. Check Node >= 18
# ---------------------------------------------------------------------------
info "Checking Node.js version..."

if ! command -v node &>/dev/null; then
  error "Node.js is not installed."
  echo ""
  echo "    Please install Node.js 18 or later from https://nodejs.org"
  echo "    (LTS is recommended)"
  echo ""
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js $NODE_VERSION is installed, but Spore requires Node >= 18."
  echo ""
  echo "    Please upgrade: https://nodejs.org"
  echo ""
  exit 1
fi

success "Node.js $NODE_VERSION detected (>= 18 required)"

# ---------------------------------------------------------------------------
# 3. Check ANTHROPIC_API_KEY
# ---------------------------------------------------------------------------
info "Checking ANTHROPIC_API_KEY..."

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  error "ANTHROPIC_API_KEY is not set in your environment."
  echo ""
  echo "    Spore uses Claude (via the Anthropic API) to score and tailor"
  echo "    job applications. You need an API key to run agent steps."
  echo ""
  echo "    Get your key at: https://console.anthropic.com"
  echo ""
  echo "    Then add it to your shell profile (~/.zshrc, ~/.bashrc, etc.):"
  echo ""
  echo "        export ANTHROPIC_API_KEY=\"sk-ant-...\""
  echo ""
  echo "    Re-run this script after setting the variable."
  echo ""
  exit 1
fi

success "ANTHROPIC_API_KEY is set"

# ---------------------------------------------------------------------------
# 4. npm install
# ---------------------------------------------------------------------------
info "Installing dependencies (npm install)..."
echo ""

# Run from repo root (script lives in scripts/, so go one level up)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_ROOT"
npm install

echo ""
success "Dependencies installed"

# ---------------------------------------------------------------------------
# 5. Seed data/ from data.example/ (only if data/ doesn't exist yet)
# ---------------------------------------------------------------------------
info "Checking for existing data directory..."

if [ -d "$REPO_ROOT/data" ]; then
  warn "data/ already exists — skipping seed copy to preserve your data."
else
  info "Copying data.example/ → data/ ..."
  cp -r "$REPO_ROOT/data.example" "$REPO_ROOT/data"
  success "data/ seeded from data.example/"
  echo ""
  echo "    The seed data includes an example profile and job postings."
  echo "    Run the onboard skill in Claude Code to personalise your profile."
fi

# ---------------------------------------------------------------------------
# 6. Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}Setup complete.${RESET} Run 'npm run dev' to start the frontend at http://localhost:3100"
echo ""
