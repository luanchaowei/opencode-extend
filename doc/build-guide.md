# 编译打包指南

## 环境要求

- Bun >= 1.3.13

## 编译

```bash
bash build.sh
```

## 产物

| 文件 | 说明 |
|------|------|
| `dist-bin/opencode-extend` | 可执行文件（约 121MB） |
| `dist-bin/opencode-extend.tar.gz` | 安装包（约 45MB），包含可执行文件 + .env.example |

## 部署

```bash
# 解压
tar xzf opencode-extend.tar.gz

# 配置
cp .env.example .env
vim .env

# 启动
./opencode-extend
```

也可通过命令行传参，优先级高于 .env：

```bash
./opencode-extend --host 0.0.0.0 --port 3000 --server-host 127.0.0.1 --server-port 4096 --workspace /home/user/client
```

## 命令行参数

```
./opencode-extend --help
```

| 参数 | 对应 .env 变量 | 说明 |
|------|---------------|------|
| `--host <addr>` | `WEB_HOST` | 前端监听地址 |
| `--port <port>` | `WEB_PORT` | 前端端口 |
| `--log <path>` | `LOG_PATH` | 日志文件路径 |
| `--server-host <addr>` | `VITE_OPENCODE_SERVER_HOST` | opencode 后端地址 |
| `--server-port <port>` | `VITE_OPENCODE_SERVER_PORT` | opencode 后端端口 |
| `--server-password <pwd>` | `VITE_OPENCODE_SERVER_PASSWORD` | 后端认证密码 |
| `--server-username <name>` | `VITE_OPENCODE_SERVER_USERNAME` | 后端认证用户名 |
| `--workspace <path>` | `VITE_OPENCODE_DEFAULT_DIR` | 用户工作目录 |
| `--stats-path <path>` | `VITE_STATS_DATA_PATH` | stats.db 存储路径 |
| `--auth-enabled` | `AUTH_ENABLED` | 启用登录认证 |
| `--admin-username <name>` | `ADMIN_USERNAME` | 超级管理员用户名 |
| `--admin-password <pwd>` | `ADMIN_PASSWORD` | 超级管理员密码 |

命令行参数优先级高于 .env。可通过系统设置页面配置的项（公告、支撑人员、知识库、监控等）不需要在此指定。
