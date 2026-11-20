# Installs the SQL Cockpit CLI (sqlcockpit) from GitHub with npm.
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'
$Repo = 'github:sql-cockpit/sql-cockpit-cli'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'sqlcockpit needs Node.js 20 or later. Install it from https://nodejs.org and run this again.'
  exit 1
}

$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 20) {
  Write-Error "sqlcockpit needs Node.js 20 or later (found $(node --version))."
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error 'npm was not found. It ships with Node.js; reinstall Node.js and run this again.'
  exit 1
}

Write-Host "Installing sqlcockpit from $Repo ..."
npm install -g $Repo
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Get-Command sqlcockpit -ErrorAction SilentlyContinue) {
  Write-Host "Installed: $(sqlcockpit version)"
  Write-Host 'Next: sqlcockpit login'
} else {
  Write-Warning "Installed, but sqlcockpit is not on your PATH. Add '$(npm prefix -g)' to PATH."
}
