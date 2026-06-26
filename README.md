# OpenCode Extend

OpenCode 自定义前端，支持以下功能：

- 聊天界面 - 与 AI 进行对话交互
- 文件树 - 浏览项目文件、上传/下载/删除文件
- 知识库管理 - 浏览和搜索本地案例库
- 统计仪表盘 - 查看用户数、会话数、在线用户等统计信息
- 帮助文档 - 快速访问帮助文档
- 问题反馈 - 提交问题反馈
- 支撑人员联系 - 快速联系支撑人员
- IP 自动路由 - 根据客户端 IP 自动进入专属项目目录
- 权限控制 - 基于客户端 IP 进行权限控制

代码仓库：https://gitcode.com/luanchaowei/opencode-extend.git

## 环境要求

- Bun >= 1.3.13

## 安装

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 克隆项目
git clone https://gitcode.com/luanchaowei/opencode-extend.git
cd opencode-extend

# 安装依赖
bun install
```

## 配置

编辑 `.env` 文件：

```bash
# 服务配置
WEB_HOST=172.17.0.1              # 前端监听地址
WEB_PORT=3000                    # 前端端口
LOG_PATH=/tmp/opencode-extend.log # 日志路径

# 后端配置
VITE_OPENCODE_SERVER_HOST=127.0.0.1   # 后端地址
VITE_OPENCODE_SERVER_PORT=4096        # 后端端口
VITE_OPENCODE_DEFAULT_DIR=/home/user/client # 默认工作目录

# 企业功能
VITE_CONTACT_ADMIN=admin:12345678      # 支撑人员联系方式
VITE_FEEDBACK_URL=https://example.com/feedback # 问题反馈 URL
VITE_CASE_LIBRARY_DIR=/path/to/cases   # 知识库目录
VITE_HELP_DOC_URL=https://docs.example.com # 帮助文档 URL
VITE_ANNOUNCEMENT_TEXT="..."           # 公告文案

# 统计功能
VITE_STATS_ADMIN_TOKEN=token          # 管理面板访问令牌
VITE_STATS_DATA_PATH=/path/to/stats   # 统计数据存储路径
```

## 启动

```bash
./restart.sh
```

访问地址：

- 前端页面：http://\<WEB_HOST\>:\<WEB_PORT\>
- 管理面板：http://\<WEB_HOST\>:\<WEB_PORT\>/admin.html?token=\<VITE_STATS_ADMIN_TOKEN\>

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
├── restart.sh    # 启动脚本
└── package.json
```

## 许可证

MIT