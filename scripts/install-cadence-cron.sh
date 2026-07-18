#!/usr/bin/env bash
# scripts/install-cadence-cron.sh
# Installs (idempotently) the daily 08:30 cadence cron entry for this checkout.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TSX="$PROJECT_DIR/node_modules/.bin/tsx"
LOG="$PROJECT_DIR/logs/cadence.log"
MARKER="run-cadence.ts"
LINE="30 8 * * * cd $PROJECT_DIR && $TSX scripts/ingestion/$MARKER >> $LOG 2>&1"

mkdir -p "$PROJECT_DIR/logs"
# `|| true`: grep exits 1 when the existing crontab is empty or has no other lines.
( crontab -l 2>/dev/null | grep -vF "$MARKER" || true ; echo "$LINE" ) | crontab -
echo "Installed cadence cron:"
crontab -l | grep -F "$MARKER"
