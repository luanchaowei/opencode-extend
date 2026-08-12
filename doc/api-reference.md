# API 接口文档

本文档描述 opencode-extend 前端服务提供的全部 HTTP API 接口。

## 认证机制

### 会话认证

当 `AUTH_ENABLED=true` 时，所有非公开接口需要携带有效的 `session_id` Cookie。

- 登录成功后，服务端通过 `Set-Cookie` 返回 `session_id`，后续请求自动携带
- 会话有效期 30 分钟，请求时自动续期（`/api/stats/heartbeat` 除外）
- 未认证的 API 请求返回 `401`，页面请求重定向到 `/login`

### 权限级别

| 权限级别 | 说明 | 判断方式 |
|---------|------|---------|
| 公开 | 无需认证 | `/api/login`、`/api/logout` |
| 已登录 | 任意已认证用户 | `AUTH_ENABLED=true` 时需有效 session |
| 管理员 | admin 或 super_admin | `requireAdmin()` |
| 超级管理员 | 仅 super_admin | `requireSuperAdmin()` |

> `AUTH_ENABLED=false` 时，所有接口无需认证，权限检查全部通过。

---

## 认证接口

### POST /api/login

用户登录，获取会话 Cookie。

**权限**：公开

**请求体**：

```json
{
  "username": "admin",
  "password": "Admin123!"
}
```

**成功响应** `200`：

```json
{
  "ok": true,
  "username": "admin",
  "role": "super_admin"
}
```

Set-Cookie: `session_id=<uuid>; HttpOnly; Path=/; Max-Age=1800; SameSite=Lax`

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | 用户名或密码为空 |
| 401 | 用户名或密码错误 |

---

### POST /api/logout

登出当前会话，清除 Cookie。

**权限**：公开

**成功响应** `200`：

```json
{ "ok": true }
```

Set-Cookie: `session_id=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`

---

### GET /api/auth/me

获取当前登录用户信息。

**权限**：已登录（未启用认证时返回空）

**成功响应** `200`：

```json
{
  "username": "admin",
  "role": "super_admin",
  "userId": 1
}
```

**未认证响应** `401`：

```json
{ "error": "Not authenticated" }
```

---

## 用户管理接口

### GET /api/users

获取所有用户列表。

**权限**：超级管理员

**成功响应** `200`：

```json
{
  "users": [
    {
      "id": 1,
      "username": "admin",
      "role": "super_admin",
      "created_at": 1718000000000,
      "updated_at": 1718000000000
    }
  ]
}
```

**错误响应** `403`：`{ "error": "Forbidden" }`

---

### POST /api/users

创建新用户。

**权限**：超级管理员

**请求体**：

```json
{
  "username": "user1",
  "password": "MyPass123!",
  "role": "user"
}
```

**密码规则**：至少 8 位，需包含数字/大写字母/小写字母/特殊字符中的 3 种。

**角色可选值**：`user`（普通用户）、`admin`（管理员）

**成功响应** `200`：

```json
{
  "ok": true,
  "user": { "id": 2, "username": "user1", "role": "user" }
}
```

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少必填字段 / 角色无效 / 密码不符合规则 / 用户名已存在 |
| 403 | 非超级管理员 |

---

### PATCH /api/users/:id

修改用户密码和/或角色。

**权限**：超级管理员

**路径参数**：`id` — 用户 ID（整数）

**请求体**（字段可选，仅传需要修改的）：

```json
{
  "password": "NewPass123!",
  "role": "admin"
}
```

**成功响应** `200`：`{ "ok": true }`

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | 用户不存在 / 密码不符合规则 / 角色无效 / 不可修改超级管理员角色 |
| 403 | 非超级管理员 |

---

### DELETE /api/users/:id

删除用户。

**权限**：超级管理员

**路径参数**：`id` — 用户 ID（整数）

**成功响应** `200`：`{ "ok": true }`

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | 用户不存在 / 不可删除超级管理员 / 不可删除自己 |
| 403 | 非超级管理员 |

---

## 设备与配置接口

### GET /device/info

获取客户端设备信息和服务端配置。前端启动时调用。

**权限**：已登录

**成功响应** `200`：

```json
{
  "clientIP": "192_168_1_100",
  "contactAdmin": ["admin:12345678"],
  "feedbackUrl": "https://example.com/feedback",
  "caseLibraryDir": "/path/to/cases",
  "helpDocUrl": "https://docs.example.com",
  "announcementText": "系统公告内容",
  "downloadCutoffText": "",
  "fileTreePollInterval": 5000,
  "heartbeatInterval": 60000,
  "diskUsageThreshold": 90,
  "defaultDir": "/home/user/client",
  "serverHost": "127.0.0.1",
  "serverPort": "4096",
  "serverUsername": "opencode",
  "serverPassword": "",
  "hiddenProviders": ["opencode", "alibaba-cn"]
}
```

> `clientIP` 为客户端 IP 地址，`.` 替换为 `_`。`hiddenProviders` 为隐藏的供应商 ID 列表，前端模型选择器和模型管理 Tab 会过滤掉这些供应商。

---

### GET /api/config/runtime

获取当前运行时配置（管理面板系统设置页面使用）。

**权限**：管理员

**成功响应** `200`：

```json
{
  "announcementText": "公告内容",
  "contactAdmin": "admin:12345678",
  "feedbackUrl": "https://example.com/feedback",
  "helpDocUrl": "https://docs.example.com",
  "downloadCutoffText": "",
  "fileTreePollInterval": "5000",
  "heartbeatInterval": "60000",
  "diskUsageThreshold": "90",
  "caseLibraryDir": "/path/to/cases",
  "monitorDiskMounts": "/",
  "monitorBackendPattern": "",
  "monitorFrontendPattern": "",
  "hiddenProviders": "opencode,alibaba-cn"
}
```

---

### PATCH /api/config/runtime

修改运行时配置。同时更新内存中的 `process.env` 和 `.env` 文件。

**权限**：管理员

**请求体**（仅传需要修改的字段）：

```json
{
  "announcementText": "新公告",
  "contactAdmin": "admin:12345678|admin2:87654321",
  "diskUsageThreshold": "85",
  "hiddenProviders": "opencode,alibaba-cn"
}
```

**可修改字段**：

| 字段 | 对应 .env 变量 |
|------|---------------|
| `announcementText` | `VITE_ANNOUNCEMENT_TEXT` |
| `contactAdmin` | `VITE_CONTACT_ADMIN` |
| `feedbackUrl` | `VITE_FEEDBACK_URL` |
| `helpDocUrl` | `VITE_HELP_DOC_URL` |
| `downloadCutoffText` | `VITE_DOWNLOAD_CUTOFF_TEXT` |
| `fileTreePollInterval` | `VITE_FILE_TREE_POLL_INTERVAL` |
| `heartbeatInterval` | `VITE_HEARTBEAT_INTERVAL` |
| `diskUsageThreshold` | `VITE_DISK_USAGE_THRESHOLD` |
| `caseLibraryDir` | `VITE_CASE_LIBRARY_DIR` |
| `monitorDiskMounts` | `VITE_MONITOR_DISK_MOUNTS` |
| `monitorBackendPattern` | `VITE_MONITOR_BACKEND_PATTERN` |
| `monitorFrontendPattern` | `VITE_MONITOR_FRONTEND_PATTERN` |
| `hiddenProviders` | `VITE_HIDDEN_PROVIDERS` |

**成功响应** `200`：`{ "success": true }`

---

## 模型管理接口

### GET /api/models/list

获取已配置的模型列表（管理面板模型管理页面使用）。

**权限**：管理员

**成功响应** `200`：

```json
{
  "models": [
    {
      "providerID": "cannbot",
      "providerName": "CANNBOT",
      "modelID": "glm-5.2",
      "modelName": "GLM-5.2",
      "status": "active",
      "testResult": {
        "success": true,
        "error": "",
        "durationMs": 1321,
        "testedAt": 1718000000000
      }
    }
  ]
}
```

> 已隐藏的供应商（`VITE_HIDDEN_PROVIDERS`）不会出现在列表中。`status` 为 `deprecated` 的模型也会被过滤。`testResult` 为历史检测结果，未检测过时为 `null`。

---

### POST /api/models/test

检测指定模型是否可用。创建临时会话发送测试消息，检测完成后自动删除临时会话，并将结果存入数据库。

**权限**：管理员

**请求体**：

```json
{
  "providerID": "cannbot",
  "modelID": "glm-5.2"
}
```

**成功响应** `200`：

```json
{ "success": true, "durationMs": 1321 }
```

**失败响应** `200`（模型不可用）：

```json
{ "success": false, "error": "错误信息", "durationMs": 500 }
```

> 不设超时，等待后端返回结果。`durationMs` 为检测耗时（毫秒）。检测结果存入 `model_test_results` 表，下次加载列表时可查看历史记录。临时会话使用 `VITE_OPENCODE_DEFAULT_DIR` 作为工作目录。

---

## 文件操作接口

### POST /file/upload

上传文件（multipart/form-data 流式处理）。

**权限**：已登录

**查询参数**：`directory` — 目标目录路径

**请求体**：`multipart/form-data`

| 字段 | 说明 |
|------|------|
| `file` | 文件数据 |
| `path` | 目标文件路径（相对 directory 或绝对路径） |

**成功响应** `200`：

```json
{ "success": true, "path": "/home/user/client/uploads/ses_xxx/file.txt" }
```

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 directory / boundary / file / path |
| 507 | 磁盘使用率超过阈值，禁止上传 |

> 上传前会检查目标目录磁盘使用率，超过 `VITE_DISK_USAGE_THRESHOLD`（默认 90%）时返回 507。

---

### GET /file/download

下载文件。

**权限**：已登录

**查询参数**：

| 参数 | 说明 |
|------|------|
| `path` | 文件路径（相对 directory 或绝对路径） |
| `directory` | 基准目录 |

**成功响应** `200`：文件二进制流，`Content-Type: application/octet-stream`，`Content-Disposition: attachment; filename*=UTF-8''<编码文件名>`

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 path / directory / 路径是目录 |
| 404 | 文件不存在 |

---

### POST /file/delete

删除文件或目录（递归删除）。

**权限**：已登录

**查询参数**：`directory` — 基准目录

**请求体**：

```json
{ "path": "uploads/ses_xxx/old_file.txt" }
```

**成功响应** `200`：`{ "success": true }`

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | 缺少 path / directory |
| 404 | 文件不存在 |

---

## 目录接口

### POST /directory/create

创建目录（递归创建）。

**权限**：已登录

**请求体**：

```json
{ "path": "/home/user/client/192_168_1_100" }
```

**成功响应** `200`：

```json
{ "success": true, "path": "/home/user/client/192_168_1_100" }
```

> 目录已存在时不报错，直接返回成功。

---

## 知识库接口

### GET /api/case-library/list

列出知识库目录下的文件和子目录。

**权限**：已登录

**查询参数**：`path` — 相对于知识库根目录的子路径（可选，默认根目录）

**成功响应** `200`：

```json
{
  "files": [
    { "name": "guide.md", "path": "guide.md" }
  ],
  "dirs": [
    { "name": "examples", "path": "examples" }
  ]
}
```

> 支持符号链接，自动解析为真实路径判断文件/目录类型。

---

### GET /api/case-library/read

读取知识库文件内容。图片返回 base64 编码，文本返回 UTF-8 字符串。

**权限**：已登录

**查询参数**：`path` — 相对于知识库根目录的文件路径

**文本文件响应** `200`：

```json
{ "content": "文件内容..." }
```

**图片文件响应** `200`：

```json
{
  "content": "base64编码数据",
  "encoding": "base64",
  "mimeType": "image/png"
}
```

**支持的图片格式**：png、jpg、jpeg、gif、webp、svg、bmp、ico

---

### GET /api/case-library/asset

以二进制流方式获取知识库中的图片资源（用于 Markdown 中的图片引用）。

**权限**：已登录

**查询参数**：`path` — 相对于知识库根目录的文件路径

**成功响应** `200`：文件二进制流，带 `Cache-Control: public, max-age=3600`

---

## 统计接口

### POST /api/stats/heartbeat

客户端心跳上报。上报当前活跃会话及状态。

**权限**：已登录

**请求体**：

```json
{
  "clientIP": "192_168_1_100",
  "sessions": [
    { "sessionID": "ses_xxx", "status": "busy" }
  ],
  "timestamp": 1718000000000
}
```

**status 可选值**：`busy`（AI处理中）、`retry`（重试中）、`idle`（空闲）

**成功响应** `200`：

```json
{ "ok": true, "buildTime": 1718000000000 }
```

> `buildTime` 为服务端构建时间戳。前端检测到变化时自动刷新页面（热部署感知）。
> 此接口不会续期会话。

---

### POST /api/stats/session-create

上报新会话创建事件。

**权限**：已登录

**请求体**：

```json
{
  "clientIP": "192_168_1_100",
  "sessionID": "ses_xxx",
  "timestamp": 1718000000000
}
```

**成功响应** `200`：`{ "ok": true }`

> 同一 clientIP + sessionID 重复上报不会重复计数（去重）。

---

### POST /api/stats/session-delete

上报会话删除事件。

**权限**：已登录

**请求体**：

```json
{ "sessionID": "ses_xxx" }
```

**成功响应** `200`：`{ "ok": true }`

---

### POST /api/stats/message-send

上报消息发送事件。

**权限**：已登录

**请求体**：

```json
{
  "sessionID": "ses_xxx",
  "timestamp": 1718000000000
}
```

**成功响应** `200`：`{ "ok": true }`

---

### GET /api/stats

获取统计数据（管理面板统计页面使用）。

**权限**：管理员

**查询参数**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `range` | 时间范围：`7d`/`1m`/`1q`/`1y`/`custom` | `7d` |
| `granularity` | 聚合粒度（custom 时生效）：`day`/`week`/`month` | `day` |
| `start` | 开始日期（custom 时生效，格式 YYYY-MM-DD） | - |
| `end` | 结束日期（custom 时生效，格式 YYYY-MM-DD） | - |

**成功响应** `200`：

```json
{
  "summary": {
    "totalClientsEver": 100,
    "onlineClients": 5,
    "totalSessionsEverCreated": 500,
    "totalMessagesEver": 3000,
    "onlineSessions": 8,
    "processingSessions": 2
  },
  "currentSessions": [
    {
      "sessionID": "ses_xxx",
      "clientIP": "192_168_1_100",
      "lastSeen": "2025-08-08 14:30:00",
      "status": "busy",
      "directory": "/home/user/client/192_168_1_100"
    }
  ],
  "trend": [
    {
      "label": "2025-08-01",
      "active_clients": 10,
      "active_sessions": 15,
      "new_sessions": 3,
      "new_clients": 1,
      "messages_sent": 50
    }
  ]
}
```

> 返回前会自动对齐会话状态：查询 opencode 后端 `/session/status` 接口，更新 busy/retry 状态。

---

## 系统监控接口

### GET /api/system/monitor

获取系统监控数据（管理面板监控页面使用）。

**权限**：管理员

**成功响应** `200`：

```json
{
  "processes": {
    "backend": {
      "pid": 12345,
      "name": "opencode",
      "cmd": "opencode serve --hostname 0.0.0.0 --port 4096",
      "cpu": "15.2",
      "memRSS": 256000,
      "memPercent": 1.5,
      "threads": 12,
      "uptime": "3天5小时",
      "ioReadKBps": "102.5",
      "ioWriteKBps": "50.3"
    },
    "frontend": { ... }
  },
  "system": {
    "cpuPercent": 25.3,
    "memTotal": 16384,
    "memUsed": 8192,
    "memPercent": 50.0,
    "loadAvg": [0.5, 0.3, 0.2]
  },
  "disks": [
    {
      "filesystem": "/dev/sda1",
      "size": "100G",
      "used": "50G",
      "avail": "50G",
      "usePercent": 50,
      "mount": "/"
    }
  ],
  "diskIO": [
    {
      "device": "sda",
      "readKBps": "1024.5",
      "writeKBps": "512.3",
      "readAwaitMs": "2.1",
      "writeAwaitMs": "3.5",
      "readUtilPercent": "10.0",
      "writeUtilPercent": "5.0"
    }
  ]
}
```

> 进程未找到时对应字段为 `null`。采样间隔 1 秒，响应时间约 1 秒。

---

## 页面路由

| 路径 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/login` | GET | 公开 | 登录页面（仅 AUTH_ENABLED=true 时可访问） |
| `/admin.html` | GET | 管理员 | 管理面板页面 |
| `/` | GET | 已登录 | 前端 SPA（未匹配路由时回退到 index.html） |

> 普通用户访问 `/admin.html` 时重定向到 `/`。

---

## 通用错误格式

所有 API 错误响应统一为 JSON 格式：

```json
{ "error": "错误描述信息" }
```

常见状态码：

| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |
| 507 | 磁盘空间不足 |
