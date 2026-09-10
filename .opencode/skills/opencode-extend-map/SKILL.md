---
name: opencode-extend-map
description: opencode-extend 项目代码地图。说明各模块代码所在位置、界面与源码文件的对应关系、后端 API 路由位置。当用户要在 opencode-extend 项目中查找某个界面/功能的代码、新增功能需求（新增对话框、新增管理面板标签页、新增文案、新增 API）、或了解项目结构时使用。项目根目录：/home/luanchaowei/code/opencode-extend
---

# opencode-extend 代码地图

OpenCode 自定义前端（"GE诊断助手"），按客户端 IP 隔离权限。项目根目录：`/home/luanchaowei/code/opencode-extend`

## 技术栈与整体架构

| 层 | 技术 | 代码位置 |
|---|---|---|
| 用户端前端 | SolidJS + Vite + Tailwind + Kobalte | `packages/app/src/` |
| 管理面板 | 单文件 HTML + Chart.js（无框架） | `packages/app/public/admin.html`（约 1300 行） |
| 后端服务 | Bun 原生 http，单文件 | `packages/app/server.js`（约 1700 行） |
| 统计数据库 | bun:sqlite | `packages/app/stats-db.js`（约 500 行，stats.db） |
| 运维脚本 | bash | 根目录 `restart.sh` / `stop.sh` / `server.sh` / `build.sh` |
| 工具脚本 | bun js | `packages/scripts/`（session-cleanup.js、query-stats.js） |

## 界面 → 代码映射（用户端）

前端路由定义在 `packages/app/src/app.tsx:308-311`：
`/` → HomeRoute；`/:dir` → DirectoryLayout；`/:dir/session/:id?` → SessionRoute

| 界面元素 | 源码文件（相对 `packages/app/src/`） |
|---|---|
| 首页 | `pages/home.tsx` |
| 会话主界面（聊天页） | `pages/session.tsx` |
| 消息时间线（对话气泡） | `pages/session/message-timeline.tsx` |
| 输入区/composer | `pages/session/composer/`（session-composer-region.tsx、session-composer-state.ts） |
| 权限确认 dock | `pages/session/composer/session-permission-dock.tsx` |
| Todo 面板 dock | `pages/session/composer/session-todo-dock.tsx` |
| 追问/问题/回退 dock | `session-question-dock.tsx`、`session-followup-dock.tsx`、`session-revert-dock.tsx` |
| 会话侧面板 | `pages/session/session-side-panel.tsx` |
| 会话命令（斜杠命令） | `pages/session/use-session-commands.tsx` |
| 侧边栏整体框架 | `pages/layout/sidebar-shell.tsx` |
| 侧边栏-会话列表 | `pages/layout/sidebar-items.tsx` |
| 侧边栏-项目切换 | `pages/layout/sidebar-project.tsx` |
| 侧边栏-工作区 | `pages/layout/sidebar-workspace.tsx` |
| 提示词输入框 | `components/prompt-input.tsx` + `components/prompt-input/` |
| 文件树 | `components/file-tree.tsx` |
| 新建会话对话框 | `components/dialog-new-session.tsx` |
| 模型选择对话框 | `components/dialog-select-model.tsx` |
| 模型管理对话框 | `components/dialog-manage-models.tsx` |
| Fork 会话对话框 | `components/dialog-fork.tsx` |
| 案例库/知识库对话框 | `components/dialog-case-library.tsx` |
| 编辑项目对话框 | `components/dialog-edit-project.tsx` |
| 选择目录对话框 | `components/dialog-select-directory.tsx` |
| 发布说明对话框 | `components/dialog-release-notes.tsx` |
| 问题反馈组件 | `components/feedback-widgets.tsx` |
| 新手指引（onboarding tour） | `components/onboarding-tour.tsx` |
| 标题栏 | `components/titlebar.tsx` |
| Markdown 目录 | `components/markdown-toc.tsx` |
| 服务器列表行 | `components/server/server-row.tsx` |
| 全局状态（Context） | `context/`（settings、models、permission、file、server 等 20+ 个） |
| 国际化文案（中/英） | `i18n/zh.ts`、`i18n/en.ts`（key-value 字典） |
| 工具函数 | `utils/`（diffs.ts、notification-click.ts、server-health.ts 等） |
| 入口 | `entry.tsx` |

## 界面 → 代码映射（管理端）

管理面板整体在 `packages/app/public/admin.html`（单文件，内嵌 CSS/JS，Chart.js CDN）。入口 URL：`/admin.html`，仅 admin 角色可访问（拦截在 `server.js:1589` 附近）。

| 标签页（界面） | admin.html 容器 id | 数据来源 API |
|---|---|---|
| 使用统计 | `tab-stats` | `/api/stats?range=...` |
| 系统监控 | `tab-monitor` | `/api/system/monitor` |
| 模型管理 | `tab-models` | `/api/models/list`、`/api/models/test`、`/api/models/test-all` |
| 用户管理（仅超管可见） | `tab-users` | `/api/users`（GET/POST/PATCH/DELETE） |
| 系统设置 | `tab-settings` | `/api/config/runtime`（GET/PATCH） |

标签切换函数：`switchTab(...)`。登录/注册/会话不存在页由 `server.js:1559-1576` 直接返回 HTML。

## 后端 API 路由位置（server.js）

> 行号为参考值，会随代码更新漂移；精确定位用 `grep -n 'url.pathname.*<api>' server.js`

| API | 方法 | 位置（约） | 功能 |
|---|---|---|---|
| `/api/login`、`/api/register`、`/api/logout`、`/api/auth/me` | POST/GET | 547-597 | 登录认证 |
| `/api/users`、`/api/users/:id` | GET/POST/PATCH/DELETE | 600-658 | 用户管理 |
| `/device/info` | GET | 660 | 设备信息 |
| `/directory/create` | POST | 688 | 创建工作目录 |
| `/api/case-library/list\|read\|asset` | GET | 701-792 | 案例库/知识库 |
| `/file/upload\|download\|delete` | POST/GET | 775-990 | 文件操作 |
| `/api/stats/heartbeat`、`session-create`、`session-delete`、`message-send` | POST | 991-1064 | 统计埋点 |
| `/api/stats` | GET | 1065 | 统计聚合查询 |
| `/api/models/list\|test\|test-all` | GET/POST | 1137-1243 | 模型管理 |
| `/api/logs` | GET | 1244 | 日志查看 |
| `/api/system/monitor` | GET | 1267 | 系统监控 |
| `/api/config/runtime` | GET/PATCH | 1279-1300 | 运行时配置 |
| `/api/onboarding/complete` | POST | 1005 | 新手指引完成标记 |
| opencode 后端代理（PROXY_PREFIXES：`/session`、`/project`、`/config`、`/event` 等） | — | 1603-1700 | 转发到 opencode 服务（默认 127.0.0.1:4096），含目录权限过滤与响应改写 |

权限拦截主逻辑（登录校验、admin.html 角色限制、IP→工作目录映射）：`server.js:1550-1700`。

## 数据库（stats-db.js → stats.db）

表结构详见 `doc/database-schema.md`。写入时机：心跳/会话创建/删除/发消息埋点。

## 常见需求 → 改动位置速查

| 需求 | 改动位置 |
|---|---|
| 聊天界面加 UI 元素 | `pages/session.tsx` 或 `pages/session/composer/` |
| 新增弹窗/对话框 | 仿照 `components/dialog-*.tsx` 新建组件，在使用的页面引入 |
| 侧边栏调整 | `pages/layout/sidebar-*.tsx` |
| 新增界面文案（中英文） | `i18n/zh.ts` + `i18n/en.ts` 同时加 key（en 为类型基准） |
| 管理面板加标签页 | `admin.html`：nav 加 `nav-xxx` 项 + `switchTab` 分支 + `tab-xxx` 容器 |
| 管理面板新功能的数据 | `server.js` 加 API 路由 +（需持久化时）`stats-db.js` 加表 |
| 新增后端 API | `server.js` 加 `if (url.pathname === ...)` 分支（注意放在鉴权逻辑之后） |
| 修改按 IP 隔离/权限规则 | `server.js:1550-1700` |
| 新增统计指标 | `stats-db.js` + `server.js` 统计接口 + `admin.html` tab-stats 展示 |
| 新增斜杠命令 | `pages/session/use-session-commands.tsx` |
| 修改启动/端口/认证配置 | 根目录 `.env` 或 CLI 参数（`server.js` 头部 validArgs） |

## 文档索引（doc/）

| 文档 | 内容 |
|---|---|
| `doc/user-guide.md` | 用户端各界面功能说明 |
| `doc/admin-guide.md` | 管理面板各标签页操作说明 |
| `doc/api-reference.md` | 全部 HTTP API 的参数/响应/权限 |
| `doc/database-schema.md` | stats.db 表结构、索引、写入时机 |
| `doc/install-guide.md` | 部署安装 |
| `doc/tools-guide.md` | 会话清理/统计查询工具脚本 |
| `doc/build-guide.md` | 编译为独立可执行文件 |

## 常用命令

```bash
bash /home/luanchaowei/code/opencode-extend/restart.sh          # 前端开发/重启（dev|prod、--build）
bash /home/luanchaowei/code/opencode-extend/server.sh {start|stop|restart|status}  # 后端服务
bash /home/luanchaowei/code/opencode-extend/stop.sh             # 停止前端
bash /home/luanchaowei/code/opencode-extend/build.sh            # 编译独立可执行文件
```

## 注意点

1. 行号仅为编写时参考值，实际定位以 `grep -n` 结果为准
2. 用户端是 SolidJS（非 React），信号用 `createSignal`/`createResource`
3. 管理面板是原生 HTML/JS 单文件，改它不需要重新构建前端
4. 改 `i18n` 时 zh/en 必须成对添加（`type Keys = keyof typeof en`）
5. server.js 是单文件函数式路由，新增 API 注意 pathname 前缀不冲突
