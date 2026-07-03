#!/usr/bin/env bash
#
# Unspaghettit one-shot installer (macOS / Linux).
#
# For people who just want to try AI + MCP without fighting a terminal. Run:
#
#     curl -fsSL https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.sh | sh
#
# What it does, in order:
#   1. Checks for Node.js + npm. If missing (or too old), installs Node LTS via
#      Homebrew on macOS; otherwise it points you at the Node download page.
#   2. Installs the `unspaghettit` CLI globally (npm install -g).
#   3. Registers the Unspaghettit MCP server GLOBALLY with every AI client it
#      finds on this machine (Claude Code, Claude Desktop, Cursor, Codex, ...),
#      so the tools attach in every project without re-running anything.
#   4. Prints what to do next.
#
# It never touches a repo: no CLAUDE.md, .gitignore, or skills are written here.
# Re-running is safe.

set -eu

# Node engines floor from package.json ("node": ">=20.10").
MIN_NODE_MAJOR=20
MIN_NODE_MINOR=10

# Colors when stdout is a terminal; plain otherwise (e.g. piped into a file).
if [ -t 1 ]; then
  C_CYAN=$(printf '\033[36m'); C_GREEN=$(printf '\033[32m')
  C_YELLOW=$(printf '\033[33m'); C_GRAY=$(printf '\033[90m'); C_RESET=$(printf '\033[0m')
else
  C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_GRAY=''; C_RESET=''
fi

head() { printf '\n%s=== %s%s\n' "$C_CYAN" "$1" "$C_RESET"; }
ok()   { printf '%s  [ok] %s%s\n' "$C_GREEN" "$1" "$C_RESET"; }
info() { printf '%s  %s%s\n' "$C_GRAY" "$1" "$C_RESET"; }
warn() { printf '%s  [!] %s%s\n' "$C_YELLOW" "$1" "$C_RESET"; }

# Returns 0 when node exists and is >= the required version.
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  ver=$(node --version 2>/dev/null | sed 's/^v//')   # e.g. 22.9.0
  major=$(printf '%s' "$ver" | cut -d. -f1)
  minor=$(printf '%s' "$ver" | cut -d. -f2)
  [ -n "$major" ] || return 1
  if [ "$major" -gt "$MIN_NODE_MAJOR" ]; then return 0; fi
  if [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]; then return 0; fi
  return 1
}

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 || true      # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true  # Linux
  fi
}

install_node() {
  head "Installing Node.js LTS"
  os=$(uname -s)
  if [ "$os" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    info "Using Homebrew..."
    if brew install node; then ok "Node.js is ready."; return 0; fi
    warn "Homebrew could not install Node automatically."
  elif [ "$os" = "Darwin" ]; then
    warn "Homebrew is not installed."
  else
    warn "No supported auto-installer for this OS."
    info "On Linux, install Node LTS with your package manager or nvm (https://github.com/nvm-sh/nvm)."
  fi
  warn "Please install Node.js LTS by hand, then re-run this command."
  info "Opening https://nodejs.org/en/download ..."
  open_url 'https://nodejs.org/en/download'
  return 1
}

# --- 1. Node.js -------------------------------------------------------------
head "Checking for Node.js + npm"
if node_ok; then
  ok "Node.js $(node --version) found."
else
  if command -v node >/dev/null 2>&1; then
    warn "Node.js $(node --version) is older than the required v${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}."
  else
    info "Node.js was not found."
  fi
  install_node || exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  warn "npm is not on your PATH even though Node is installed."
  info "Open a new terminal, then re-run this command."
  exit 1
fi

# --- 2. Install the CLI -----------------------------------------------------
head "Installing the Unspaghettit CLI (npm install -g unspaghettit)"
if ! npm install -g unspaghettit; then
  warn "Global install failed (often a permissions issue on system Node)."
  info "Try again with sudo:  sudo npm install -g unspaghettit"
  info "Or switch to a user-owned Node via nvm so no sudo is needed."
  exit 1
fi
ok "CLI installed."

# --- 3. Register the MCP globally with detected clients ---------------------
head "Registering the MCP server with your AI clients (global)"
info "Only clients already on this machine are wired up."
unspa init --scope global --yes --no-context --no-gitignore --no-skills

# --- 4. Next steps ----------------------------------------------------------
head "Done"
ok "Unspaghettit is installed."
info "Restart any AI client that was open so it picks up the new tools."
info "Open the dashboard any time with:  unspa dashboard"
info "No AI client detected above? Install one (Claude Desktop, Claude Code,"
info "Cursor, or Codex), then re-run:  unspa init"
