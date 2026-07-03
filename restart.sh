#!/bin/bash

set -e

MODE="${1:-prod}"

if [ "$MODE" != "dev" ] && [ "$MODE" != "prod" ]; then
  echo "用法: bash restart.sh [dev|prod]"
  echo "  dev  - 开发模式（Vite dev server，支持 HMR）"
  echo "  prod - 生产模式（build + server.js，无 HMR，更快）[默认]"
  exit 1
fi

cd "$(dirname "$0")"

set -a
source .env
set +a

bash stop.sh
while ss -tlnp | grep -q ":${WEB_PORT:-3000} "; do sleep 0.5; done

LOG_FILE="${LOG_PATH:-/tmp/opencode-extend.log}"
for i in 5 4 3 2 1; do
  if [ "$i" = "5" ]; then
    rm -f "${LOG_FILE}.${i}" 2>/dev/null || true
  else
    [ -f "${LOG_FILE}.${i}" ] && mv "${LOG_FILE}.${i}" "${LOG_FILE}.$((i+1))" 2>/dev/null || true
  fi
done
[ -f "${LOG_FILE}" ] && mv "${LOG_FILE}" "${LOG_FILE}.1" 2>/dev/null || true

if [ "$MODE" = "prod" ]; then
  echo "构建前端..."
  bun --cwd packages/app build
  echo "启动生产模式: http://${WEB_HOST:-0.0.0.0}:${WEB_PORT:-3000}"
  nohup bun packages/app/server.js > "${LOG_PATH:-/tmp/opencode-extend.log}" 2>&1 &
else
  echo "启动开发模式: http://${WEB_HOST:-0.0.0.0}:${WEB_PORT:-3000}"
  nohup bun --cwd packages/app dev --host "${WEB_HOST:-0.0.0.0}" --port "${WEB_PORT:-3000}" > "${LOG_PATH:-/tmp/opencode-extend.log}" 2>&1 &
fi

echo "日志: ${LOG_PATH:-/tmp/opencode-extend.log}"