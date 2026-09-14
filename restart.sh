#!/bin/bash

set -e

for arg in "$@"; do
  if [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then
    echo "用法: bash restart.sh [dev|prod] [--build]"
    echo "  dev      - 开发模式（Vite dev server，支持 HMR）"
    echo "  prod     - 生产模式（server.js，无 HMR，更快）[默认]"
    echo "  --build  - 启动前先构建前端（仅 prod 模式生效）"
    exit 0
  fi
done

MODE="prod"
BUILD=false
for arg in "$@"; do
  if [ "$arg" = "dev" ] || [ "$arg" = "prod" ]; then
    MODE="$arg"
  elif [ "$arg" = "--build" ]; then
    BUILD=true
  else
    echo "无效参数: $arg"
    echo "用法: bash restart.sh [dev|prod] [--build]"
    echo "运行 'bash restart.sh --help' 查看帮助"
    exit 1
  fi
done

if [ "$MODE" != "dev" ] && [ "$MODE" != "prod" ]; then
  echo "无效模式: $MODE，请使用 --help 查看用法"
  exit 1
fi

cd "$(dirname "$0")"

set -a
source .env
set +a

# 构建前端（在停止服务前执行，缩短故障窗口；构建失败时旧服务保持运行）
if [ "$MODE" = "prod" ] && [ "$BUILD" = true ]; then
  echo "构建前端..."
  bun --cwd packages/app build
fi

bash stop.sh
while ss -tlnp | grep -q ":${WEB_PORT:-3000} "; do sleep 0.5; done

if [ "$MODE" = "prod" ]; then
  echo "启动生产模式: http://${WEB_HOST:-0.0.0.0}:${WEB_PORT:-3000}"
  nohup bun packages/app/server.js > "${LOG_PATH:-/tmp/opencode-extend.log}" 2>&1 &
else
  echo "启动开发模式: http://${WEB_HOST:-0.0.0.0}:${WEB_PORT:-3000}"
  nohup bun --cwd packages/app dev --host "${WEB_HOST:-0.0.0.0}" --port "${WEB_PORT:-3000}" > "${LOG_PATH:-/tmp/opencode-extend.log}" 2>&1 &
fi

echo "日志: ${LOG_PATH:-/tmp/opencode-extend.log}"
