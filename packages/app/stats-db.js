import { existsSync, readFileSync, renameSync } from "node:fs"
import { dirname } from "node:path"
import { mkdirSync } from "node:fs"
import { randomBytes, createHash } from "node:crypto"

const getTzTime = () => new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })

const getDayKey = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function createStatsDb(Database, dbPath, statsJsonPath) {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const rawDb = new Database(dbPath)

  const hasTransaction = typeof rawDb.transaction === "function"
  const hasQuery = typeof rawDb.query === "function"

  const db = {
    exec: (...args) => rawDb.exec(...args),
    query: hasQuery ? (...args) => rawDb.query(...args) : (...args) => rawDb.prepare(...args),
    transaction: hasTransaction
      ? (...args) => rawDb.transaction(...args)
      : (fn) => (...args) => {
          rawDb.exec("BEGIN")
          try {
            const result = fn(...args)
            rawDb.exec("COMMIT")
            return result
          } catch (err) {
            rawDb.exec("ROLLBACK")
            throw err
          }
        },
  }

  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA foreign_keys = ON")

  db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      key   TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS heartbeats (
      client_ip TEXT PRIMARY KEY,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS heartbeat_sessions (
      client_ip  TEXT,
      session_id TEXT,
      status     TEXT,
      last_seen  INTEGER,
      PRIMARY KEY (client_ip, session_id),
      FOREIGN KEY (client_ip) REFERENCES heartbeats(client_ip) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS daily_stats (
      day_key             TEXT PRIMARY KEY,
      active_clients      INTEGER DEFAULT 0,
      active_sessions     INTEGER DEFAULT 0,
      new_sessions        INTEGER DEFAULT 0,
      new_clients         INTEGER DEFAULT 0,
      messages_sent       INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS client_day_seen (
      client_ip TEXT,
      day_key   TEXT,
      PRIMARY KEY (client_ip, day_key),
      FOREIGN KEY (day_key) REFERENCES daily_stats(day_key) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS session_day_seen (
      session_id TEXT,
      day_key    TEXT,
      PRIMARY KEY (session_id, day_key),
      FOREIGN KEY (day_key) REFERENCES daily_stats(day_key) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hb_sessions_sid ON heartbeat_sessions(session_id);
    CREATE INDEX IF NOT EXISTS idx_cds_day ON client_day_seen(day_key);
    CREATE INDEX IF NOT EXISTS idx_sds_day ON session_day_seen(day_key);
    CREATE INDEX IF NOT EXISTS idx_hb_last ON heartbeats(last_seen);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_test_results (
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      success INTEGER NOT NULL,
      error TEXT,
      duration_ms INTEGER NOT NULL,
      tested_at INTEGER NOT NULL,
      PRIMARY KEY (provider_id, model_id)
    );
  `)

  db.query("INSERT OR IGNORE INTO counters VALUES ('totalSessionsEverCreated', 0)").run()
  db.query("INSERT OR IGNORE INTO counters VALUES ('totalMessagesEver', 0)").run()

  try { db.exec("ALTER TABLE heartbeats ADD COLUMN user_id INTEGER DEFAULT NULL") } catch {}
  try { db.exec("ALTER TABLE heartbeat_sessions ADD COLUMN user_id INTEGER DEFAULT NULL") } catch {}

  migrateFromJson(statsJsonPath)

  function ensureDayStats(dayKey) {
    db.query("INSERT OR IGNORE INTO daily_stats (day_key) VALUES (?)").run(dayKey)
  }

  function migrateFromJson(jsonPath) {
    const hbCount = db.query("SELECT COUNT(*) as c FROM heartbeats").get().c
    if (hbCount > 0) return
    if (!existsSync(jsonPath)) return

    let data
    try {
      data = JSON.parse(readFileSync(jsonPath, "utf8"))
    } catch {
      console.error(`[${getTzTime()}] migration: failed to parse ${jsonPath}, skipping`)
      return
    }

    db.exec("PRAGMA foreign_keys = OFF")
    const txn = db.transaction(() => {
      for (const [ip, hb] of Object.entries(data.heartbeats || {})) {
        db.query("INSERT OR REPLACE INTO heartbeats (client_ip, last_seen) VALUES (?, ?)").run(ip, hb.lastSeen)
        for (const [sid, s] of Object.entries(hb.sessions || {})) {
          db.query("INSERT OR REPLACE INTO heartbeat_sessions (client_ip, session_id, status, last_seen) VALUES (?, ?, ?, ?)").run(ip, sid, s.status, s.lastSeen)
        }
      }
      for (const [day, val] of Object.entries(data.dailyStats || {})) {
        db.query("INSERT OR REPLACE INTO daily_stats VALUES (?,?,?,?,?,?)").run(
          day,
          val.activeClients || 0,
          val.activeSessions || 0,
          val.newSessions || 0,
          val.newClients || 0,
          val.messagesSent || 0,
        )
      }
      for (const key of Object.keys(data.clientDaySeen || {})) {
        const parts = key.split(":")
        const day = parts.pop()
        const ip = parts.join(":")
        db.query("INSERT OR IGNORE INTO client_day_seen VALUES (?, ?)").run(ip, day)
      }
      for (const key of Object.keys(data.sessionDaySeen || {})) {
        const parts = key.split(":")
        const day = parts.pop()
        const sid = parts.join(":")
        db.query("INSERT OR IGNORE INTO session_day_seen VALUES (?, ?)").run(sid, day)
      }
      db.query("INSERT OR REPLACE INTO counters VALUES (?, ?)").run("totalSessionsEverCreated", data.totalSessionsEverCreated || 0)
      db.query("INSERT OR REPLACE INTO counters VALUES (?, ?)").run("totalMessagesEver", data.totalMessagesEver || 0)
    })
    txn()
    db.exec("PRAGMA foreign_keys = ON")

    try {
      renameSync(jsonPath, jsonPath + ".bak")
      console.log(`[${getTzTime()}] migration: stats.json -> stats.db complete, backup saved as ${jsonPath}.bak`)
    } catch (err) {
      console.error(`[${getTzTime()}] migration: failed to backup stats.json: ${err.message}`)
    }
  }

  function heartbeat(clientIP, sessions, timestamp) {
    const dayKey = getDayKey(timestamp)
    const txn = db.transaction(() => {
      ensureDayStats(dayKey)
      const hb = db.query("SELECT 1 FROM heartbeats WHERE client_ip = ?").get(clientIP)
      if (!hb) {
        db.query("INSERT INTO heartbeats (client_ip, last_seen) VALUES (?, ?)").run(clientIP, timestamp)
        db.query("UPDATE daily_stats SET new_clients = new_clients + 1 WHERE day_key = ?").run(dayKey)
      } else {
        db.query("UPDATE heartbeats SET last_seen = ? WHERE client_ip = ?").run(timestamp, clientIP)
      }

      const reportedIDs = (sessions || []).map((s) => s.sessionID)
      if (reportedIDs.length > 0) {
        const placeholders = reportedIDs.map(() => "?").join(",")
        db.query(
          `UPDATE heartbeat_sessions SET status = 'idle'
           WHERE client_ip = ? AND status IN ('busy','retry')
           AND session_id NOT IN (${placeholders})`,
        ).run(clientIP, ...reportedIDs)
      } else {
        db.query(
          `UPDATE heartbeat_sessions SET status = 'idle'
           WHERE client_ip = ? AND status IN ('busy','retry')`,
        ).run(clientIP)
      }

      for (const s of sessions || []) {
        db.query("UPDATE heartbeat_sessions SET status = ?, last_seen = ? WHERE client_ip = ? AND session_id = ?").run(
          s.status,
          timestamp,
          clientIP,
          s.sessionID,
        )
      }

      const cds = db.query("SELECT 1 FROM client_day_seen WHERE client_ip = ? AND day_key = ?").get(clientIP, dayKey)
      if (!cds) {
        db.query("INSERT INTO client_day_seen VALUES (?, ?)").run(clientIP, dayKey)
        db.query("UPDATE daily_stats SET active_clients = active_clients + 1 WHERE day_key = ?").run(dayKey)
      }

      for (const s of sessions || []) {
        const exists = db.query("SELECT 1 FROM heartbeat_sessions WHERE client_ip = ? AND session_id = ?").get(clientIP, s.sessionID)
        if (!exists) continue
        const sds = db.query("SELECT 1 FROM session_day_seen WHERE session_id = ? AND day_key = ?").get(s.sessionID, dayKey)
        if (!sds) {
          db.query("INSERT INTO session_day_seen VALUES (?, ?)").run(s.sessionID, dayKey)
          db.query("UPDATE daily_stats SET active_sessions = active_sessions + 1 WHERE day_key = ?").run(dayKey)
        }
      }
    })
    txn()
  }

  function sessionCreate(clientIP, sessionID, timestamp) {
    const dayKey = getDayKey(timestamp)
    const result = { isNew: false }
    const txn = db.transaction(() => {
      ensureDayStats(dayKey)
      const hb = db.query("SELECT 1 FROM heartbeats WHERE client_ip = ?").get(clientIP)
      if (!hb) {
        db.query("INSERT INTO heartbeats (client_ip, last_seen) VALUES (?, ?)").run(clientIP, timestamp)
        db.query("UPDATE daily_stats SET new_clients = new_clients + 1 WHERE day_key = ?").run(dayKey)
      }

      const existing = db.query("SELECT 1 FROM heartbeat_sessions WHERE client_ip = ? AND session_id = ?").get(clientIP, sessionID)
      if (!existing) {
        db.query("INSERT INTO heartbeat_sessions (client_ip, session_id, status, last_seen) VALUES (?, ?, ?, ?)").run(clientIP, sessionID, "idle", timestamp)
        db.query("UPDATE counters SET value = value + 1 WHERE key = 'totalSessionsEverCreated'").run()
        db.query("UPDATE daily_stats SET new_sessions = new_sessions + 1 WHERE day_key = ?").run(dayKey)
        result.isNew = true
        result.total = db.query("SELECT value FROM counters WHERE key = 'totalSessionsEverCreated'").get().value
      }
    })
    txn()
    return result
  }

  function sessionDelete(sessionID) {
    db.query("DELETE FROM heartbeat_sessions WHERE session_id = ?").run(sessionID)
  }

  function messageSend(timestamp) {
    const dayKey = getDayKey(timestamp)
    const txn = db.transaction(() => {
      db.query("UPDATE counters SET value = value + 1 WHERE key = 'totalMessagesEver'").run()
      ensureDayStats(dayKey)
      db.query("UPDATE daily_stats SET messages_sent = messages_sent + 1 WHERE day_key = ?").run(dayKey)
    })
    txn()
  }

  function getOnlineStats(tenMinAgo) {
    const hbRows = db.query("SELECT client_ip, last_seen FROM heartbeats WHERE last_seen >= ?").all(tenMinAgo)
    const sessionRows = db
      .query(
        `SELECT client_ip, session_id, status, last_seen
         FROM heartbeat_sessions
         WHERE last_seen >= ?`,
      )
      .all(tenMinAgo)

    let onlineClients = hbRows.length
    let onlineSessions = 0
    let processingSessions = 0
    const currentSessions = []
    const pad = (n) => String(n).padStart(2, "0")

    for (const s of sessionRows) {
      onlineSessions++
      if (s.status === "busy" || s.status === "retry") processingSessions++
      const d = new Date(s.last_seen)
      currentSessions.push({
        sessionID: s.session_id,
        clientIP: s.client_ip,
        lastSeen: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
        status: s.status,
      })
    }

    const statusSortOrder = { busy: 0, retry: 1, idle: 2 }
    currentSessions.sort((a, b) => (statusSortOrder[a.status] ?? 3) - (statusSortOrder[b.status] ?? 3))

    return { onlineClients, onlineSessions, processingSessions, currentSessions }
  }

  function getCounters() {
    const totalClientsEver = db.query("SELECT COUNT(*) as c FROM heartbeats").get().c
    const totalSessionsEverCreated = db.query("SELECT value FROM counters WHERE key = 'totalSessionsEverCreated'").get()?.value || 0
    const totalMessagesEver = db.query("SELECT value FROM counters WHERE key = 'totalMessagesEver'").get()?.value || 0
    return { totalClientsEver, totalSessionsEverCreated, totalMessagesEver }
  }

  function getAggregatedTrend(range, granularity, startDate, endDate) {
    let cutoff, whereClause, params, aggExpr

    if (range === "custom" && startDate) {
      cutoff = startDate
      whereClause = "day_key >= ?"
      params = [cutoff]
      if (endDate) {
        whereClause += " AND day_key <= ?"
        params.push(endDate)
      }
      if (granularity === "month") {
        aggExpr = "substr(day_key, 1, 7)"
      } else if (granularity === "week") {
        aggExpr = "strftime('%Y-W%W', day_key)"
      } else {
        aggExpr = "day_key"
      }
    } else {
      const days = { "7d": 7, "1m": 30, "1q": 90, "1y": 365 }[range] || 7
      cutoff = getDayKey(Date.now() - days * 86400000)
      whereClause = "day_key >= ?"
      params = [cutoff]
      if (range === "7d" || range === "1m") {
        aggExpr = "day_key"
      } else if (range === "1q") {
        aggExpr = "strftime('%Y-W%W', day_key)"
      } else {
        aggExpr = "substr(day_key, 1, 7)"
      }
    }

    const rows = db
      .query(
        `WITH ds AS (
           SELECT ${aggExpr} as agg_key,
             SUM(new_sessions) as new_sessions,
             COALESCE(SUM(new_clients), 0) as new_clients,
             COALESCE(SUM(messages_sent), 0) as messages_sent
           FROM daily_stats WHERE ${whereClause} GROUP BY agg_key
         ),
         cds AS (
           SELECT ${aggExpr} as agg_key,
             COUNT(DISTINCT client_ip) as active_clients
           FROM client_day_seen WHERE ${whereClause} GROUP BY agg_key
         ),
         sds AS (
           SELECT ${aggExpr} as agg_key,
             COUNT(DISTINCT session_id) as active_sessions
           FROM session_day_seen WHERE ${whereClause} GROUP BY agg_key
         )
         SELECT
           ds.agg_key as label,
           COALESCE(cds.active_clients, 0) as active_clients,
           COALESCE(sds.active_sessions, 0) as active_sessions,
           ds.new_sessions,
           COALESCE(ds.new_clients, 0) as new_clients,
           COALESCE(ds.messages_sent, 0) as messages_sent
         FROM ds
         LEFT JOIN cds ON ds.agg_key = cds.agg_key
         LEFT JOIN sds ON ds.agg_key = sds.agg_key
         ORDER BY ds.agg_key`,
      )
      .all(...params, ...params, ...params)

    return rows
  }

  function getBusySessionDirs(tenMinAgo) {
    const rows = db
      .query(
        `SELECT DISTINCT hs.client_ip as ip
         FROM heartbeat_sessions hs
         JOIN heartbeats h ON hs.client_ip = h.client_ip
         WHERE h.last_seen >= ? AND hs.status IN ('busy','retry')`,
      )
      .all(tenMinAgo)
    return rows.map((r) => r.ip)
  }

  function getBusySessions(tenMinAgo) {
    return db
      .query(
        `SELECT hs.client_ip as ip, hs.session_id as sid, hs.status
         FROM heartbeat_sessions hs
         JOIN heartbeats h ON hs.client_ip = h.client_ip
         WHERE h.last_seen >= ? AND hs.status IN ('busy','retry')`,
      )
      .all(tenMinAgo)
  }

  function updateSessionStatus(clientIP, sessionID, status) {
    db.query("UPDATE heartbeat_sessions SET status = ? WHERE client_ip = ? AND session_id = ?").run(status, clientIP, sessionID)
  }

  function cleanupOldStats(cutoffDayKey) {
    db.query("DELETE FROM daily_stats WHERE day_key < ?").run(cutoffDayKey)
  }

  function hashPassword(password, salt) {
    return createHash("sha256").update(password + salt).digest("hex")
  }

  function validatePassword(pwd) {
    if (!pwd || pwd.length < 8) return false
    let types = 0
    if (/[0-9]/.test(pwd)) types++
    if (/[a-z]/.test(pwd)) types++
    if (/[A-Z]/.test(pwd)) types++
    if (/[^a-zA-Z0-9]/.test(pwd)) types++
    return types >= 3
  }

  function ensureSuperAdmin(username, password) {
    const row = db.query("SELECT id, password, salt FROM users WHERE username = ? AND role = 'super_admin'").get(username)
    const salt = row?.salt || randomBytes(16).toString("hex")
    const hash = hashPassword(password, salt)
    if (!row) {
      db.query("INSERT INTO users (username, password, salt, role, created_at, updated_at) VALUES (?, ?, ?, 'super_admin', ?, ?)").run(
        username, hash, salt, Date.now(), Date.now()
      )
      console.log(`[${getTzTime()}] super_admin '${username}' created`)
    } else if (row.password !== hash) {
      db.query("UPDATE users SET password = ?, salt = ?, updated_at = ? WHERE id = ?").run(hash, salt, Date.now(), row.id)
      console.log(`[${getTzTime()}] super_admin '${username}' password updated`)
    }
  }

  function createUser(username, password, role) {
    username = (username || "").trim()
    if (!username || !password || !role) return { error: "Missing required fields" }
    if (role !== "admin" && role !== "user") return { error: "Invalid role" }
    if (!validatePassword(password)) return { error: "Password must be at least 8 chars with 3 of: digits, lowercase, uppercase, special chars" }
    const existing = db.query("SELECT 1 FROM users WHERE username = ?").get(username)
    if (existing) return { error: "Username already exists" }
    const salt = randomBytes(16).toString("hex")
    const hash = hashPassword(password, salt)
    const now = Date.now()
    const result = db.query("INSERT INTO users (username, password, salt, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      username, hash, salt, role, now, now
    )
    return { id: result.lastInsertRowid, username, role }
  }

  function deleteUser(id) {
    const row = db.query("SELECT role FROM users WHERE id = ?").get(id)
    if (!row) return { error: "User not found" }
    if (row.role === "super_admin") return { error: "Cannot delete super_admin" }
    db.query("DELETE FROM users WHERE id = ?").run(id)
    return { success: true }
  }

  function listUsers() {
    return db.query("SELECT id, username, role, created_at, updated_at FROM users ORDER BY created_at ASC").all()
  }

  function verifyUser(username, password) {
    const row = db.query("SELECT id, username, role, password, salt FROM users WHERE username = ?").get(username)
    if (!row) return null
    const hash = hashPassword(password, row.salt)
    if (hash !== row.password) return null
    return { id: row.id, username: row.username, role: row.role }
  }

  function updateUserPassword(id, password) {
    if (!validatePassword(password)) return { error: "Password must be at least 8 chars with 3 of: digits, lowercase, uppercase, special chars" }
    const row = db.query("SELECT role FROM users WHERE id = ?").get(id)
    if (!row) return { error: "User not found" }
    const salt = randomBytes(16).toString("hex")
    const hash = hashPassword(password, salt)
    db.query("UPDATE users SET password = ?, salt = ?, updated_at = ? WHERE id = ?").run(hash, salt, Date.now(), id)
    return { success: true }
  }

  function updateUserRole(id, role) {
    if (role !== "admin" && role !== "user") return { error: "Invalid role" }
    const row = db.query("SELECT role FROM users WHERE id = ?").get(id)
    if (!row) return { error: "User not found" }
    if (row.role === "super_admin") return { error: "Cannot change super_admin role" }
    db.query("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, Date.now(), id)
    return { success: true }
  }

  function saveModelTestResult(providerID, modelID, success, error, durationMs) {
    db.query("INSERT OR REPLACE INTO model_test_results VALUES (?, ?, ?, ?, ?, ?)").run(
      providerID, modelID, success ? 1 : 0, error || "", durationMs, Date.now()
    )
  }

  function getModelTestResults() {
    return db.query("SELECT provider_id, model_id, success, error, duration_ms, tested_at FROM model_test_results").all()
  }

  function close() {
    rawDb.close()
  }

  return {
    heartbeat,
    sessionCreate,
    sessionDelete,
    messageSend,
    getOnlineStats,
    getCounters,
    getAggregatedTrend,
    getBusySessionDirs,
    getBusySessions,
    updateSessionStatus,
    cleanupOldStats,
    ensureSuperAdmin,
    createUser,
    deleteUser,
    listUsers,
    verifyUser,
    updateUserPassword,
    updateUserRole,
    validatePassword,
    saveModelTestResult,
    getModelTestResults,
    close,
  }
}
