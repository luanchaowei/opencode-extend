#!/bin/bash

set -e

cd "$(dirname "$0")"

set -a
source .env
set +a

SERVER_HOST="${VITE_OPENCODE_SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${VITE_OPENCODE_SERVER_PORT:-4096}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_PORT="${WEB_PORT:-3000}"
LOG_FILE="${LOG_PATH:-/tmp/opencode-extend.log}"
PID_FILE="$(dirname "$0")/opencode-server.pid"

start() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "后端服务已在运行 (PID: $(cat "$PID_FILE"))"
    exit 1
  fi

  CORS_ORIGIN="http://${WEB_HOST}:${WEB_PORT}"
  echo "启动后端: ${SERVER_HOST}:${SERVER_PORT} (CORS: ${CORS_ORIGIN})"
  nohup opencode serve --hostname "$SERVER_HOST" --port "$SERVER_PORT" --cors "$CORS_ORIGIN" > "${LOG_FILE}.server" 2>&1 &
  echo $! > "$PID_FILE"
  echo "PID: $(cat "$PID_FILE")"
  echo "日志: ${LOG_FILE}.server"
}

stop() {
  if [ ! -f "$PID_FILE" ]; then
    echo "PID 文件不存在，尝试查找进程..."
    pkill -f "opencode serve" && echo "已停止" || echo "未找到运行中的进程"
    exit 0
  fi

  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "已停止后端服务 (PID: $PID)"
  else
    echo "进程 $PID 不存在"
  fi
  rm -f "$PID_FILE"
}

status() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "后端服务运行中 (PID: $(cat "$PID_FILE"))"
    echo "地址: ${SERVER_HOST}:${SERVER_PORT}"
  else
    echo "后端服务未运行"
    exit 1
  fi
}

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *)
    echo "用法: bash server.sh {start|stop|restart|status}"
    echo "  start    启动 opencode 后端服务"
    echo "  stop     停止 opencode 后端服务"
    echo "  restart  重启 opencode 后端服务"
    echo "  status   查看运行状态"
    exit 1
    ;;
esac
