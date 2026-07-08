#!/bin/bash

cd "$(dirname "$0")"

set -a
source .env
set +a

MONITOR_LOG="/tmp/opencode-monitor.log"

if ! pgrep -f "opencode serve" > /dev/null; then
    nohup opencode serve \
      --port ${VITE_OPENCODE_SERVER_PORT:-4096} \
      --hostname ${VITE_OPENCODE_SERVER_HOST:-172.17.0.1} \
      --cors http://${WEB_HOST:-0.0.0.0}:${WEB_PORT:-3000} > /dev/null 2>&1 &
    echo "[$(date)] backend (opencode serve) restarted" >> ${MONITOR_LOG}
fi

if ! pgrep -f "bun.*packages/app" > /dev/null; then
    bash restart.sh prod >> ${MONITOR_LOG} 2>&1
    echo "[$(date)] frontend restarted via restart.sh" >> ${MONITOR_LOG}
fi
