#!/bin/bash

set -e

# 进入项目目录
cd "$(dirname "$0")"

# 加载 .env
set -a
source .env
set +a

# 停止旧进程
pkill -f "bun.*packages/app.*${WEB_PORT:-3000}" || true

# 启动
echo "启动 Web 前端: http://${WEB_HOST:-0.0.0.0}:${WEB_PORT:-3000}"
nohup bun --cwd packages/app dev --host "${WEB_HOST:-0.0.0.0}" --port "${WEB_PORT:-3000}" > "${LOG_PATH:-/tmp/opencode-extend.log}" 2>&1 &

sleep 2
echo "日志: ${LOG_PATH:-/tmp/opencode-extend.log}"