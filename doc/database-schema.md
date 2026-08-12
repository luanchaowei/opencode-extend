# 数据库表结构

本文档描述 opencode-extend 统计数据库（stats.db）的表结构、索引和存储规则。

## 概述

- **数据库类型**：SQLite
- **数据库文件**：`<VITE_STATS_DATA_PATH>/stats.db`（默认可执行文件所在目录）
- **PRAGMA 设置**：`journal_mode = WAL`、`synchronous = NORMAL`、`foreign_keys = ON`
- **数据清理**：自动删除 365 天前的 `daily_stats` 记录（每天执行一次）
- **数据迁移**：首次启动时如检测到旧版 `stats.json` 文件，自动迁移到 stats.db 并将原文件重命名为 `.bak`

## 表结构

### counters

全局计数器，存储累计指标。

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | TEXT PRIMARY KEY | 计数器名称 |
| `value` | INTEGER DEFAULT 0 | 计数值 |

**预置记录**：

| key | 说明 |
|-----|------|
| `totalSessionsEverCreated` | 历史创建的会话总数 |
| `totalMessagesEver` | 历史发送的消息总数 |

---

### heartbeats

客户端心跳记录，每个客户端 IP 一行。

| 字段 | 类型 | 说明 |
|------|------|------|
| `client_ip` | TEXT PRIMARY KEY | 客户端 IP（`.` 和 `:` 替换为 `_`） |
| `last_seen` | INTEGER | 最后一次心跳时间戳（毫秒） |
| `user_id` | INTEGER DEFAULT NULL | 关联用户 ID（预留字段） |

> `user_id` 为预留字段，通过 `ALTER TABLE` 动态添加，当前未实际使用。

---

### heartbeat_sessions

会话心跳记录，记录每个客户端下的会话状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `client_ip` | TEXT | 客户端 IP（关联 heartbeats.client_ip） |
| `session_id` | TEXT | 会话 ID |
| `status` | TEXT | 会话状态：`busy`/`retry`/`idle` |
| `last_seen` | INTEGER | 最后一次心跳时间戳（毫秒） |
| `user_id` | INTEGER DEFAULT NULL | 关联用户 ID（预留字段） |

**主键**：`(client_ip, session_id)`

**外键**：`client_ip` → `heartbeats(client_ip)` ON DELETE CASCADE

> `user_id` 为预留字段，通过 `ALTER TABLE` 动态添加，当前未实际使用。

---

### daily_stats

每日统计聚合数据，每天一行。

| 字段 | 类型 | 说明 |
|------|------|------|
| `day_key` | TEXT PRIMARY KEY | 日期，格式 `YYYY-MM-DD` |
| `active_clients` | INTEGER DEFAULT 0 | 当日活跃客户端数 |
| `active_sessions` | INTEGER DEFAULT 0 | 当日活跃会话数 |
| `new_sessions` | INTEGER DEFAULT 0 | 当日新建会话数 |
| `new_clients` | INTEGER DEFAULT 0 | 当日新增客户端数 |
| `messages_sent` | INTEGER DEFAULT 0 | 当日发送消息数 |

> `active_clients` 和 `active_sessions` 来自 `client_day_seen` 和 `session_day_seen` 的去重计数。`new_sessions` 和 `new_clients` 在事件发生时递增。`messages_sent` 在每次消息发送时递增。

---

### client_day_seen

客户端-日期关联表，记录每个客户端在哪些日期活跃过。

| 字段 | 类型 | 说明 |
|------|------|------|
| `client_ip` | TEXT | 客户端 IP |
| `day_key` | TEXT | 日期（关联 daily_stats.day_key） |

**主键**：`(client_ip, day_key)`

**外键**：`day_key` → `daily_stats(day_key)` ON DELETE CASCADE

> 用于计算 `active_clients`：同一 client_ip 在同一天只计一次。插入时同时递增 `daily_stats.active_clients`。

---

### session_day_seen

会话-日期关联表，记录每个会话在哪些日期活跃过。

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | TEXT | 会话 ID |
| `day_key` | TEXT | 日期（关联 daily_stats.day_key） |

**主键**：`(session_id, day_key)`

**外键**：`day_key` → `daily_stats(day_key)` ON DELETE CASCADE

> 用于计算 `active_sessions`：同一 session_id 在同一天只计一次。插入时同时递增 `daily_stats.active_sessions`。

---

### users

用户表，存储登录账户信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 用户 ID |
| `username` | TEXT UNIQUE NOT NULL | 用户名 |
| `password` | TEXT NOT NULL | 密码哈希（SHA-256） |
| `salt` | TEXT NOT NULL | 密码盐值（16 字节随机十六进制） |
| `role` | TEXT NOT NULL | 角色：`super_admin`/`admin`/`user` |
| `created_at` | INTEGER NOT NULL | 创建时间戳（毫秒） |
| `updated_at` | INTEGER NOT NULL | 更新时间戳（毫秒） |

**密码存储**：`SHA-256(password + salt)`，每个用户独立盐值。

---

### model_test_results

模型检测结果记录表，每个 provider+model 组合一条记录（覆盖更新）。

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider_id` | TEXT NOT NULL | 供应商 ID |
| `model_id` | TEXT NOT NULL | 模型 ID |
| `success` | INTEGER NOT NULL | 检测结果：1=可用，0=不可用 |
| `error` | TEXT | 错误信息（成功时为空） |
| `duration_ms` | INTEGER NOT NULL | 检测耗时（毫秒） |
| `tested_at` | INTEGER NOT NULL | 检测时间戳（毫秒） |

**主键**：`(provider_id, model_id)`

> 每次检测后通过 `INSERT OR REPLACE` 覆盖更新，只保留最近一次检测结果。

## 索引

| 索引名 | 表 | 字段 | 说明 |
|--------|------|------|------|
| `idx_hb_sessions_sid` | `heartbeat_sessions` | `session_id` | 按会话 ID 查询 |
| `idx_cds_day` | `client_day_seen` | `day_key` | 按日期聚合客户端 |
| `idx_sds_day` | `session_day_seen` | `day_key` | 按日期聚合会话 |
| `idx_hb_last` | `heartbeats` | `last_seen` | 查询最近活跃客户端 |

## 表关系

```
heartbeats (client_ip PK)
  └── heartbeat_sessions (client_ip + session_id PK, FK → heartbeats.client_ip CASCADE)

daily_stats (day_key PK)
  ├── client_day_seen (client_ip + day_key PK, FK → daily_stats.day_key CASCADE)
  └── session_day_seen (session_id + day_key PK, FK → daily_stats.day_key CASCADE)

counters (key PK)        独立表，无外键关联

users (id PK)            独立表，无外键关联
```

## 数据写入时机

| 事件 | 触发接口 | 写入的表/字段 |
|------|---------|--------------|
| 客户端首次心跳 | `POST /api/stats/heartbeat` | `heartbeats` 插入 + `daily_stats.new_clients` 递增 |
| 客户端重复心跳 | `POST /api/stats/heartbeat` | `heartbeats.last_seen` 更新 |
| 客户端当日首次活跃 | `POST /api/stats/heartbeat` | `client_day_seen` 插入 + `daily_stats.active_clients` 递增 |
| 会话当日首次活跃 | `POST /api/stats/heartbeat` | `session_day_seen` 插入 + `daily_stats.active_sessions` 递增 |
| 会话状态变更 | `POST /api/stats/heartbeat` | `heartbeat_sessions.status` 更新 |
| 新建会话 | `POST /api/stats/session-create` | `heartbeat_sessions` 插入 + `counters.totalSessionsEverCreated` 递增 + `daily_stats.new_sessions` 递增 |
| 删除会话 | `POST /api/stats/session-delete` | `heartbeat_sessions` 删除对应行 |
| 发送消息 | `POST /api/stats/message-send` | `counters.totalMessagesEver` 递增 + `daily_stats.messages_sent` 递增 |
| 状态对齐 | `GET /api/stats`（服务端内部） | `heartbeat_sessions.status` 更新为后端实际状态 |

## 数据清理

| 清理对象 | 触发时机 | 规则 |
|---------|---------|------|
| `daily_stats` | 启动时 + 每天 | 删除 365 天前的记录（CASCADE 联动删除 `client_day_seen` 和 `session_day_seen` 对应行） |
