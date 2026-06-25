#!/bin/bash

set -e

# 进入项目目录
cd "$(dirname "$0")"

# 加载 .env
set -a
source .env
set +a

# 停止进程
pkill -f "bun.*packages/app.*${WEB_PORT:-3000}"
