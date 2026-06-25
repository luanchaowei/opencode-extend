# OpenCode Extend

OpenCode 企业版前端，基于 [opencode](https://github.com/anomalyco/opencode) 定制开发。

## 环境要求

- Node.js >= 20
- Bun >= 1.3.13

## 快速开始

```bash
# 安装依赖
bun install

# 启动服务
./restart.sh
```

访问地址：`http://<WEB_HOST>:<WEB_PORT>`

## 配置

编辑 `.env` 文件：

```bash
# 服务配置
WEB_HOST=172.17.0.1          # 前端监听地址
WEB_PORT=3000                # 前端端口
LOG_PATH=/tmp/opencode-extend.log  # 日志路径

# 后端配置
VITE_OPENCODE_SERVER_HOST=127.0.0.1  # 后端服务地址
VITE_OPENCODE_SERVER_PORT=4096        # 后端服务端口
VITE_OPENCODE_DEFAULT_DIR=/home/user  # 默认工作目录

# 企业功能配置
VITE_CONTACT_ADMIN=admin:12345678           # 支撑人员联系方式（格式：名称:号码|名称:号码）
VITE_FEEDBACK_URL=https://example.com       # 问题反馈 URL
VITE_CASE_LIBRARY_DIR=/path/to/cases        # 知识库目录
VITE_HELP_DOC_URL=https://docs.example.com  # 帮助文档 URL

# 统计功能配置
VITE_STATS_ADMIN_TOKEN=your-token    # 统计页面访问令牌
VITE_STATS_DATA_PATH=/path/to/stats  # 统计数据存储路径
```

## 项目结构

```
opencode-extend/
├── packages/
│   ├── app/          # 前端应用（SolidJS + Vite）
│   ├── ui/           # UI 组件库
│   ├── sdk/          # SDK
│   └── core/         # 核心工具（仅 util）
├── patches/          # 依赖补丁
├── .env              # 环境配置
├── restart.sh        # 启动脚本
└── package.json      # 项目配置
```

## 企业功能

- **知识库管理**：浏览和搜索本地案例库
- **统计仪表盘**：查看用户数、会话数、在线用户等统计信息
- **帮助文档**：快速访问帮助文档
- **问题反馈**：快速提交问题反馈
- **支撑人员联系**：快速联系支撑人员

## 开发

```bash
# 开发模式
bun --cwd packages/app dev

# 构建生产版本
bun --cwd packages/app build
```

## 许可证

MIT