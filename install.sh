#!/bin/sh
# Installs the SQL Cockpit CLI (sqlcockpit) from GitHub with npm.
# Usage: sh install.sh
set -eu

REPO="github:sql-cockpit/sql-cockpit-cli"

if ! command -v node >/dev/null 2>&1; then
  echo "sqlcockpit needs Node.js 20 or later. Install it from https://nodejs.org and run this again." >&2
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "sqlcockpit needs Node.js 20 or later (found $(node --version))." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. It ships with Node.js; reinstall Node.js and run this again." >&2
  exit 1
fi

echo "Installing sqlcockpit from $REPO ..."
npm install -g "$REPO"

if command -v sqlcockpit >/dev/null 2>&1; then
  echo "Installed: $(sqlcockpit version)"
  echo "Next: sqlcockpit login"
else
  echo "Installed, but sqlcockpit is not on your PATH. Add \"$(npm prefix -g)/bin\" to PATH." >&2
fi
