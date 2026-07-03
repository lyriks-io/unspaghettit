<#
  Unspaghettit one-shot installer (Windows).

  For people who just want to try AI + MCP and do not want to fight a terminal.
  Run it with, in PowerShell:

      irm https://raw.githubusercontent.com/lyriks-io/unspaghettit/main/install.ps1 | iex

  What it does, in order:
    1. Checks for Node.js + npm. If missing (or too old), installs Node LTS via
       winget; if winget is unavailable it opens the Node download page and stops.
    2. Installs the `unspaghettit` CLI globally (npm install -g).
    3. Registers the Unspaghettit MCP server GLOBALLY with every AI client it
       finds on this machine (Claude Code, Claude Desktop, Cursor, Codex, ...),
       so the tools attach in every project without re-running anything.
    4. Prints what to do next.

  It never touches a repo: no CLAUDE.md, .gitignore, or skills are written here.
  Re-running is safe.
#>

$ErrorActionPreference = 'Stop'
# Node engines floor from package.json ("node": ">=20.10").
$MinNodeMajor = 20
$MinNodeMinor = 10

function Write-Head($msg) { Write-Host "`n=== $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [ok] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }
function Write-Warn($msg) { Write-Host "  [!] $msg" -ForegroundColor Yellow }

# Reload PATH (and other machine/user env) into this session so tools installed
# a moment ago by winget / the Node MSI are callable without a new terminal.
function Update-SessionPath {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $extra   = @('C:\Program Files\nodejs', (Join-Path $env:APPDATA 'npm'))
  $parts   = @($machine, $user) + $extra | Where-Object { $_ -and (Test-Path $_ -IsValid) }
  $env:Path = ($parts -join ';')
}

# node --version -> [major, minor] or $null if node is absent / unparseable.
function Get-NodeVersion {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $null }
  try {
    $raw = (& node --version) 2>$null   # e.g. "v22.9.0"
    if ($raw -match 'v(\d+)\.(\d+)') { return @([int]$Matches[1], [int]$Matches[2]) }
  } catch {}
  return $null
}

function Test-NodeOk {
  $v = Get-NodeVersion
  if (-not $v) { return $false }
  if ($v[0] -gt $MinNodeMajor) { return $true }
  if ($v[0] -eq $MinNodeMajor -and $v[1] -ge $MinNodeMinor) { return $true }
  return $false
}

function Install-Node {
  Write-Head "Installing Node.js LTS"
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Info "Using winget (you may see a Windows permission prompt)..."
    $wingetRan = $true
    try {
      winget install --id OpenJS.NodeJS.LTS -e --source winget `
        --accept-package-agreements --accept-source-agreements
    } catch {
      $wingetRan = $false
      Write-Warn "winget could not install Node automatically."
    }
    Update-SessionPath
    if (Test-NodeOk) { Write-Ok "Node.js is ready."; return $true }
    if ($wingetRan) {
      # Installed, but this shell's PATH predates it and could not be refreshed.
      Write-Warn "Node.js was installed but is not visible in this window yet."
      Write-Info "Close this terminal, open a new one, and run this command again."
      return $false
    }
  } else {
    Write-Warn "winget is not available on this machine."
  }

  # Could not auto-install: hand off to the official installer.
  Write-Warn "Please install Node.js LTS by hand, then re-run this command."
  Write-Info "Opening https://nodejs.org/en/download ..."
  try { Start-Process 'https://nodejs.org/en/download' } catch {}
  return $false
}

# --- 1. Node.js -------------------------------------------------------------
Write-Head "Checking for Node.js + npm"
Update-SessionPath
if (Test-NodeOk) {
  $v = Get-NodeVersion
  Write-Ok "Node.js v$($v[0]).$($v[1]) found."
} else {
  $v = Get-NodeVersion
  if ($v) { Write-Warn "Node.js v$($v[0]).$($v[1]) is older than the required v$MinNodeMajor.$MinNodeMinor." }
  else    { Write-Info "Node.js was not found." }
  if (-not (Install-Node)) { exit 1 }
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Warn "npm is not on your PATH even though Node is installed."
  Write-Info "Close and reopen your terminal, then re-run this command."
  exit 1
}

# --- 2. Install the CLI -----------------------------------------------------
Write-Head "Installing the Unspaghettit CLI (npm install -g unspaghettit)"
npm install -g unspaghettit
Update-SessionPath
Write-Ok "CLI installed."

# Resolve the CLI shim directly from npm's global prefix so we do not depend on
# PATH having picked up the freshly written shims in this same session.
$npmPrefix = (& npm config get prefix 2>$null).Trim()
$unspaCmd = if ($npmPrefix) { Join-Path $npmPrefix 'unspa.cmd' } else { 'unspa' }
if (-not (Test-Path $unspaCmd)) { $unspaCmd = 'unspa' }

# --- 3. Register the MCP globally with detected clients ---------------------
Write-Head "Registering the MCP server with your AI clients (global)"
Write-Info "Only clients already on this machine are wired up."
& $unspaCmd init --scope global --yes --no-context --no-gitignore --no-skills

# --- 4. Next steps ----------------------------------------------------------
Write-Head "Done"
Write-Ok "Unspaghettit is installed."
Write-Info "Restart any AI client that was open so it picks up the new tools."
Write-Info "Open the dashboard any time with:  unspa dashboard"
Write-Info "No AI client detected above? Install one (Claude Desktop, Claude Code,"
Write-Info "Cursor, or Codex), then re-run:  unspa init"
