# 工具脚本指南

本文档介绍 opencode-extend 提供的命令行工具脚本的使用方法。

## 会话清理（session-cleanup.js）

清理过期会话、已归档会话和孤儿上传目录。

### 基本用法

```bash
bun packages/scripts/session-cleanup.js [模式] [选项]
```

### 模式

| 模式 | 说明 | 默认天数 |
|------|------|---------|
| `--inactive`（默认） | 清理未归档且超过 N 天未活跃的会话 | 14 天 |
| `--archived` | 清理所有已归档会话 | - |
| `--orphans` | 清理孤儿上传目录（会话已删除但上传目录残留） | - |

### 选项

| 选项 | 说明 |
|------|------|
| `--days <number>` | 不活跃天数阈值（仅 `--inactive` 模式生效，默认 14） |
| `--all` | 清理所有未归档会话，忽略时间阈值（仅 `--inactive` 模式生效） |
| `--db <path>` | 指定 opencode 数据库路径（默认 `~/.local/share/opencode/opencode.db`） |
| `--dry-run` | 预览将要删除的内容，不实际删除 |
| `--help` | 查看帮助 |

### 示例

```bash
# 清理 14 天未活跃的会话（默认）
bun packages/scripts/session-cleanup.js

# 清理 30 天未活跃的会话
bun packages/scripts/session-cleanup.js --days 30

# 清理所有已归档会话
bun packages/scripts/session-cleanup.js --archived

# 清理孤儿上传目录
bun packages/scripts/session-cleanup.js --orphans

# 预览将要删除的内容（不实际删除）
bun packages/scripts/session-cleanup.js --dry-run

# 查看帮助
bun packages/scripts/session-cleanup.js --help
```

### 定时执行

建议凌晨定时执行会话清理：

```bash
# 每天凌晨 3 点清理 14 天未活跃的会话
0 3 * * * cd /path/to/opencode-extend && bun packages/scripts/session-cleanup.js --days 14 >> /tmp/session-cleanup.log 2>&1
```

### 清理行为

- **inactive 模式**：通过 opencode API 删除会话记录，同时删除对应的上传目录，最后执行 VACUUM 和 WAL checkpoint 回收磁盘空间
- **archived 模式**：删除所有已归档会话，行为同 inactive
- **orphans 模式**：扫描所有客户端 IP 目录下的 uploads 文件夹，删除数据库中已不存在的会话上传目录

## 统计数据库查询（query-stats.js）

以只读方式查询统计数据库（stats.db），输出 JSON 格式结果。

### 基本用法

```bash
bun packages/scripts/query-stats.js "<SQL>"
```

### 选项

| 选项 | 说明 |
|------|------|
| `--sql <sql>` | SQL 语句（也可作为位置参数直接传入） |
| `--help` | 查看帮助 |

### 数据库路径

默认读取 `.env` 中 `VITE_STATS_DATA_PATH` 指定目录下的 `stats.db`。如未配置，回退到 `~/.local/share/opencode/stats.db`。

### 数据表结构

| 表名 | 说明 |
|------|------|
| `counters` | 全局计数器（总会话数、总消息数） |
| `heartbeats` | 客户端心跳记录 |
| `heartbeat_sessions` | 会话心跳记录（含状态） |
| `daily_stats` | 每日统计聚合（活跃用户、会话、消息等） |
| `client_day_seen` | 客户端-日期关联表 |
| `session_day_seen` | 会话-日期关联表 |
| `users` | 用户表（用户名、密码哈希、角色） |

### 示例

```bash
# 查询所有心跳记录
bun packages/scripts/query-stats.js "SELECT * FROM heartbeats"

# 查询最近 5 天的统计数据
bun packages/scripts/query-stats.js "SELECT * FROM daily_stats ORDER BY day_key DESC LIMIT 5"

# 查询全局计数器
bun packages/scripts/query-stats.js "SELECT * FROM counters"

# 查询会话总数
bun packages/scripts/query-stats.js "SELECT COUNT(*) FROM session_day_seen"

# 使用 --sql 参数
bun packages/scripts/query-stats.js --sql "SELECT * FROM users"
```

## Skill 管理（skill-manager.sh）

将本项目 `.opencode/skills/` 下的所有 opencode skill 安装到全局（或指定）目录，并同步合并 `AGENTS.md` 约束规则，使其在任意会话中生效。

### 基本用法

```bash
# 查看帮助（不带参数执行同样显示帮助）
./skill-manager.sh --help

# 安装到全局目录（~/.config/opencode/skills，任何会话生效）
./skill-manager.sh --install

# 安装到指定目录（AGENTS.md 位于该目录上一级）
./skill-manager.sh --install --path /path/to/skills
./skill-manager.sh install --path=/path/to/skills

# 卸载（删除已安装的本项目 skill，并从 AGENTS.md 移除本项目规则）
./skill-manager.sh --uninstall
./skill-manager.sh --uninstall --path /path/to/skills

# 查看安装状态
./skill-manager.sh --list
./skill-manager.sh --list --path /path/to/skills
```

### AGENTS.md 合并规则

- **install**：目标 `AGENTS.md` 不存在时直接复制；已存在时按 `## 规则名` 分节合并——同名规则用本项目版本覆盖，目标独有规则保留，本项目新增规则追加到末尾
- **uninstall**：按本项目 `AGENTS.md` 的规则名从目标中移除对应节，目标独有规则保留；若目标仅含本项目内容则整个删除
- 兼容位置参数用法：`./skill-manager.sh install <目录>`

### 错误处理

未知命令、未知选项、`--path` 缺值/重复指定/未与命令一起使用、参数过多等情况均报错并以非零码退出。
