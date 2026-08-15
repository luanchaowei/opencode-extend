# OpenCode Extend

OpenCode 自定义前端，支持按客户端IP进行权限隔离。

## 详细文档

- [使用指南](doc/user-guide.md) - 面向终端用户，按模块详细介绍各功能使用方法
- [运维指南](doc/admin-guide.md) - 面向管理员，登录认证、统计面板、系统监控、系统设置和用户管理说明
- [API 接口文档](doc/api-reference.md) - 全部 HTTP API 接口的路径、参数、响应和权限说明
- [数据库表结构](doc/database-schema.md) - stats.db 的表结构、字段、索引和存储规则
- [工具脚本指南](doc/tools-guide.md) - 会话清理和统计数据库查询工具的使用方法
- [编译打包指南](doc/build-guide.md) - 编译为独立可执行文件

## 环境要求

- Bun >= 1.3.13
- opencode >= 1.14.39

## 部署说明

前端和服务端必须部署在同一台服务器上：

- 文件上传/下载需要访问同一文件系统
- 统计功能需要访问 opencode 数据库

服务端与客户端参数必须对齐：

| 服务端参数 | 客户端 (.env) | 说明 |
|---|---|---|
| `--port 4096` | `VITE_OPENCODE_SERVER_PORT=4096` | 端口必须一致 |
| `--hostname 172.17.0.1` | `VITE_OPENCODE_SERVER_HOST=172.17.0.1` | 地址必须一致，使用服务器实际 IP |
| `--cors http://172.17.0.1:3000` | `WEB_HOST=172.17.0.1` + `WEB_PORT=3000` | CORS 允许前端地址 |

> 注意：服务端设置了 `OPENCODE_SERVER_PASSWORD` 认证密码后，前端需在 `.env` 中配置相同的 `VITE_OPENCODE_SERVER_PASSWORD`。用户名默认为 `opencode`，如服务端通过 `OPENCODE_SERVER_USERNAME` 自定义了用户名，前端必须配置相同的 `VITE_OPENCODE_SERVER_USERNAME`。

### 登录认证

设置 `AUTH_ENABLED=true` 启用前端登录认证。启用后用户必须登录才能访问，支持三种角色：

- **超级管理员（super_admin）**：通过 `ADMIN_USERNAME`/`ADMIN_PASSWORD` 配置，可管理用户
- **管理员（admin）**：由超级管理员创建，可访问管理面板
- **普通用户（user）**：由超级管理员创建或通过注册页面自助注册，仅可使用聊天界面

详见 [运维指南](doc/admin-guide.md)。

## 安装自定义界面

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 克隆项目
git clone https://gitcode.com/luanchaowei/opencode-extend.git
cd opencode-extend

# 安装依赖
bun install
```

## 配置自定义界面

编辑 `.env` 文件：

```bash
# 服务配置
WEB_HOST=172.17.0.1              # 前端监听地址
WEB_PORT=3000                    # 前端端口
LOG_PATH=/tmp/opencode-extend.log # 日志路径

# 后端配置（需与服务端 --port 和 --hostname 对齐）
VITE_OPENCODE_SERVER_HOST=172.17.0.1   # 后端地址
VITE_OPENCODE_SERVER_PORT=4096         # 后端端口
VITE_OPENCODE_DEFAULT_DIR=/home/user/client # 默认工作目录

# 后端认证
VITE_OPENCODE_SERVER_PASSWORD=""        # 后端认证密码，为空表示不认证
VITE_OPENCODE_SERVER_USERNAME="opencode" # 后端认证用户名，必须与服务端一致，默认 opencode

# 登录认证
AUTH_ENABLED=false                      # 是否启用登录，false=不登录直接用
ADMIN_USERNAME=admin                    # 超级管理员用户名（仅 AUTH_ENABLED=true 时生效）
ADMIN_PASSWORD=Admin123!                # 超级管理员密码
VITE_REGISTRATION_ENABLED=false          # 是否开放用户自助注册，true=开放注册页面，false=关闭（默认）

# 企业功能
VITE_CONTACT_ADMIN=admin:12345678      # 支撑人员联系方式
VITE_FEEDBACK_URL=https://example.com/feedback # 问题反馈 URL
VITE_CASE_LIBRARY_DIR=/path/to/cases   # 知识库目录
VITE_HELP_DOC_URL=https://docs.example.com # 帮助文档 URL
VITE_ANNOUNCEMENT_TEXT="..."           # 公告文案
VITE_DOWNLOAD_CUTOFF_TEXT=""            # 下载截断标记

# 系统参数
VITE_FILE_TREE_POLL_INTERVAL=5000      # 文件树自动刷新间隔（毫秒），默认 5000
VITE_HEARTBEAT_INTERVAL=60000          # 客户端心跳上报间隔（毫秒），默认 60000
VITE_DISK_USAGE_THRESHOLD=90           # 磁盘使用率阈值（%），超过则禁止上传，默认 90

# 统计数据
VITE_STATS_DATA_PATH=/path/to/stats   # 统计数据存储路径（stats.db）

# 系统监控
VITE_MONITOR_DISK_MOUNTS=/             # 监控的磁盘挂载点，逗号分隔，默认 /
VITE_MONITOR_BACKEND_PATTERN=          # 后端进程匹配规则，为空默认 opencode serve.*--port 端口
VITE_MONITOR_FRONTEND_PATTERN=         # 前端进程匹配规则，为空默认 bun.*packages/app

# 模型管理
VITE_HIDDEN_PROVIDERS=                 # 隐藏的供应商 ID，逗号分隔，隐藏后用户模型选择器和管理面板均不显示
```

## 启动自定义界面

### 启动后端服务

```bash
bash server.sh start
bash server.sh stop
bash server.sh restart
bash server.sh status
```

### 启动前端服务

支持两种模式：

```bash
# 开发模式（Vite dev server，支持 HMR 热更新）
bash restart.sh dev

# 生产模式（server.js，无 HMR，性能更好）[默认]
bash restart.sh prod

# 生产模式 + 构建前端（修改代码后需要重新构建）
bash restart.sh prod --build
```

停止前端：

```bash
bash stop.sh
```

### 编译为可执行文件

```bash
bash build.sh
```

详见 [编译打包指南](doc/build-guide.md)。

访问地址：

- 前端页面：http://\<WEB_HOST\>:\<WEB_PORT\>
- 管理面板：http://\<WEB_HOST\>:\<WEB_PORT\>/admin.html

## 工具脚本

会话清理、统计数据库查询等工具脚本的使用方法详见 [工具脚本指南](doc/tools-guide.md)。

## 项目结构

```
opencode-extend/
├── packages/
│   ├── app/      # 前端应用
│   ├── scripts/  # 工具脚本
│   ├── ui/       # UI 组件
│   ├── sdk/      # SDK
│   └── core/     # 工具库
├── doc/          # 文档
├── .env          # 环境配置
├── restart.sh    # 前端启动脚本（bash restart.sh [dev|prod] [--build]）
├── stop.sh       # 前端停止脚本
├── server.sh     # 后端服务管理脚本（start/stop/restart/status）
├── build.sh      # 编译打包脚本
└── package.json
```

## 许可证

MIT
