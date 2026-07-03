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

> 注意：服务端设置了 `OPENCODE_SERVER_PASSWORD` 认证密码后，前端连接需要提供对应密码，当前版本暂不支持，后续版本会添加。

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
# 服务配置（需与服务端 --hostname 和 --cors 对齐）
WEB_HOST=172.17.0.1              # 前端监听地址
WEB_PORT=3000                    # 前端端口
LOG_PATH=/tmp/opencode-extend.log # 日志路径

# 后端配置（需与服务端 --port 和 --hostname 对齐）
VITE_OPENCODE_SERVER_HOST=172.17.0.1   # 后端地址
VITE_OPENCODE_SERVER_PORT=4096         # 后端端口
VITE_OPENCODE_DEFAULT_DIR=/home/user/client # 默认工作目录

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

# 生产模式（build + server.js，无 HMR，性能更好）[默认]
bash restart.sh prod
```

停止前端：

```bash
bash stop.sh
```

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
├── restart.sh    # 启动脚本（bash restart.sh [dev|prod]）
├── stop.sh       # 停止脚本
└── package.json
```

## 许可证

MIT