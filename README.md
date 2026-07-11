# OpenCode Extend

OpenCode 自定义前端，支持以下功能：

- 聊天界面 - 与 AI 进行对话交互，诊断报告下载
- 文件树 - 浏览项目文件、上传/下载/删除文件
- 知识库管理 - 浏览和搜索本地案例库
- 统计仪表盘 - 查看用户数、会话数、在线用户等统计信息
- 帮助文档 - 快速访问帮助文档
- 问题反馈 - 提交问题反馈
- 支撑人员联系 - 快速联系支撑人员
- IP 自动路由 - 根据客户端 IP 自动进入专属项目目录
- 权限控制 - 基于客户端 IP 进行权限控制
- 下载回复 - 将助手回复下载为 Markdown 文件，支持截断标记配置
- 新手指引 - 首次访问自动弹出功能引导，可随时通过"新手指引"按钮重新查看
- 服务端认证 - 支持 OPENCODE_SERVER_PASSWORD 认证
- 进程监控 - 通过 monitor.sh 定时检测并自动拉起前后端进程
- 会话自动清理 - 定时清理不活跃会话，释放数据库空间

代码仓库：https://gitcode.com/luanchaowei/opencode-extend.git

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

# 企业功能
VITE_CONTACT_ADMIN=admin:12345678      # 支撑人员联系方式
VITE_FEEDBACK_URL=https://example.com/feedback # 问题反馈 URL
VITE_CASE_LIBRARY_DIR=/path/to/cases   # 知识库目录
VITE_HELP_DOC_URL=https://docs.example.com # 帮助文档 URL
VITE_ANNOUNCEMENT_TEXT="..."           # 公告文案
VITE_DOWNLOAD_CUTOFF_TEXT=""            # 下载截断标记
# 统计功能
VITE_STATS_ADMIN_TOKEN=token          # 管理面板访问令牌
VITE_STATS_DATA_PATH=/path/to/stats   # 统计数据存储路径
```

## 启动自定义界面

先启动服务端（IP 和端口需与 .env 对齐）：

```bash
opencode serve --port 4096 --hostname 172.17.0.1 --cors http://172.17.0.1:3000
```

再启动前端，支持两种模式：

```bash
# 开发模式（Vite dev server，支持 HMR 热更新）
bash restart.sh dev

# 生产模式（server.js，无 HMR，性能更好）[默认]
bash restart.sh prod

# 生产模式 + 构建前端（修改代码后需要重新构建）
bash restart.sh prod --build

# 查看帮助
bash restart.sh --help
```

停止前端：

```bash
bash stop.sh
```

进程监控（定时检测并自动拉起）：

```bash
# 添加到 crontab，每分钟检测一次
* * * * * bash /path/to/opencode-extend/monitor.sh
```

会话清理（定时清理不活跃会话，释放数据库空间）：

```bash
# 清理 14 天未活跃的会话（默认）
bun packages/scripts/session-cleanup.js

# 清理 30 天未活跃的会话
bun packages/scripts/session-cleanup.js --days 30

# 清理已归档会话
bun packages/scripts/session-cleanup.js --archived --days 7

# 清理孤儿上传目录（session 已删除但上传目录残留）
bun packages/scripts/session-cleanup.js --orphans

# 预览将要删除的内容（不实际删除）
bun packages/scripts/session-cleanup.js --dry-run

# 查看帮助
bun packages/scripts/session-cleanup.js --help

# 建议凌晨定时执行，清理后自动 VACUUM 回收空间
# 添加到 crontab，每天凌晨 3 点执行
0 3 * * * cd /path/to/opencode-extend && bun packages/scripts/session-cleanup.js --days 14 >> /tmp/session-cleanup.log 2>&1
```

> 清理会话后自动执行 `VACUUM` 和 `WAL checkpoint` 回收数据库空间，建议在凌晨低峰期执行。

访问地址：

- 前端页面：http://\<WEB_HOST\>:\<WEB_PORT\>
- 管理面板：http://\<WEB_HOST\>:\<WEB_PORT\>/admin.html?token=\<VITE_STATS_ADMIN_TOKEN\>

> **两种模式区别**：dev 模式用 Vite 开发服务器（`bun dev`），修改源码后浏览器自动刷新；prod 模式先 `vite build` 再用 `server.js` 启动 Bun 生产服务器，适合正式部署。

## 项目结构

```
opencode-extend/
├── packages/
│   ├── app/      # 前端应用
│   ├── scripts/  # 工具脚本
│   ├── ui/       # UI 组件
│   ├── sdk/      # SDK
│   └── core/     # 工具库
├── .env          # 环境配置
├── restart.sh    # 启动脚本（bash restart.sh [dev|prod] [--build]）
├── stop.sh       # 停止脚本
├── monitor.sh    # 进程监控脚本（定时检测并自动拉起）
└── package.json
```

## 许可证

MIT