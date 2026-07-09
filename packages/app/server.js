import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync, readdirSync, rmdirSync, realpathSync, renameSync, copyFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(dirname(__dirname))
const envPath = join(projectRoot, ".env")
const envVars = {}
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=")
      if (key && valueParts.length > 0) {
        let value = valueParts.join("=")
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        envVars[key] = value
        process.env[key] = process.env[key] ?? value
      }
    }
  }
}

const serverHost = envVars.VITE_OPENCODE_SERVER_HOST || "127.0.0.1"
const serverPort = parseInt(envVars.VITE_OPENCODE_SERVER_PORT || "4096")
const serverUrl = `http://${serverHost}:${serverPort}`
const serverPassword = envVars.VITE_OPENCODE_SERVER_PASSWORD || ""
const serverUsername = envVars.VITE_OPENCODE_SERVER_USERNAME || "opencode"
const serverAuthHeader = serverPassword ? `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")}` : ""
process.env.NO_PROXY = "*"
console.log("[server] NO_PROXY=* (skip proxy for all fetch requests)")
const webHost = envVars.WEB_HOST || "0.0.0.0"
const webPort = parseInt(envVars.WEB_PORT || "3000")
const distDir = join(__dirname, "dist")

function getClientIP(req, server) {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim().replace(/:/g, '').replace(/\./g, '_')
  }
  try {
    const info = server.requestIP(req)
    if (info) {
      let ip = info.address
      if (ip.startsWith('::ffff:')) ip = ip.substring(7)
      if (ip === '::1' || ip === '127.0.0.1') return 'localhost'
      return ip.replace(/:/g, '').replace(/\./g, '_')
    }
  } catch {}
  return 'localhost'
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
}

function getExt(filePath) {
  const idx = filePath.lastIndexOf('.')
  return idx >= 0 ? filePath.slice(idx) : ''
}

function serveStatic(urlPath) {
  if (urlPath === '/') urlPath = '/index.html'
  if (urlPath.includes('..')) return null
  const filePath = join(distDir, urlPath)
  if (!filePath.startsWith(distDir)) return null
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = getExt(filePath)
    return { content: readFileSync(filePath), mime: mimeTypes[ext] || 'application/octet-stream' }
  }
  return null
}

const statsDir = envVars.VITE_STATS_DATA_PATH || __dirname
const statsPath = join(statsDir, "stats.json")
const adminToken = envVars.VITE_STATS_ADMIN_TOKEN || ""

const defaults = { heartbeats: {}, totalClientsEver: 0, totalSessionsEverCreated: 0, totalSessionsCurrent: 0, totalMessagesEver: 0, dailyStats: {}, clientDaySeen: {}, sessionDaySeen: {} }
let statsData = { ...defaults }

const refreshTotalClients = () => {
  try {
    const result = execSync(`opencode db "select distinct directory from session"`, { encoding: "utf8", timeout: 10000 })
    const ips = new Set()
    for (const line of result.trim().split('\n')) {
      const match = line.trim().match(/(\d+_\d+_\d+_\d+)/)
      if (match) ips.add(match[1])
    }
    if (ips.size > 0) statsData.totalClientsEver = ips.size
  } catch {}
}

const saveStats = () => {
  refreshTotalClients()
  try {
    const dir = dirname(statsPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmpPath = statsPath + ".tmp"
    writeFileSync(tmpPath, JSON.stringify(statsData, null, 2), "utf8")
    renameSync(tmpPath, statsPath)
  } catch (err) {
    console.error("[stats] saveStats: FAILED:", err)
  }
}

const loadStats = () => {
  if (existsSync(statsPath)) {
    try {
      const raw = readFileSync(statsPath, "utf8")
      const loaded = JSON.parse(raw)
      statsData = { ...defaults, ...loaded }
      if (!statsData.totalSessionsEverCreated && statsData.totalSessionsCreated) statsData.totalSessionsEverCreated = statsData.totalSessionsCreated
      if (!statsData.totalSessionsCurrent && statsData.totalSessionsCreated) statsData.totalSessionsCurrent = statsData.totalSessionsCreated
      if (!statsData.clientDaySeen) statsData.clientDaySeen = {}
      if (!statsData.sessionDaySeen) statsData.sessionDaySeen = {}
      if (statsData.hourlyStats && Object.keys(statsData.hourlyStats).length > 0) {
        for (const [hourKey, val] of Object.entries(statsData.hourlyStats)) {
          const dayKey = hourKey.split('T')[0]
          if (!statsData.dailyStats[dayKey]) statsData.dailyStats[dayKey] = { activeClients: 0, activeSessions: 0, processingSessions: 0, newSessions: 0, messagesSent: 0 }
          statsData.dailyStats[dayKey].activeClients += val.activeClients || 0
          statsData.dailyStats[dayKey].activeSessions += val.activeSessions || 0
          statsData.dailyStats[dayKey].processingSessions += val.processingSessions || 0
          statsData.dailyStats[dayKey].newSessions += val.newSessions || 0
          statsData.dailyStats[dayKey].messagesSent += (val.messagesSent || 0)
        }
        delete statsData.hourlyStats
      }
      if (statsData.clientHourSeen && Object.keys(statsData.clientHourSeen).length > 0) {
        for (const k of Object.keys(statsData.clientHourSeen)) {
          const ip = k.split(':')[0]
          const dayKey = k.split(':')[1].split('T')[0]
          statsData.clientDaySeen[ip + ':' + dayKey] = true
        }
        delete statsData.clientHourSeen
      }
      if (statsData.sessionHourSeen && Object.keys(statsData.sessionHourSeen).length > 0) {
        for (const k of Object.keys(statsData.sessionHourSeen)) {
          const parts = k.split(':')
          const sid = parts[0]
          const dayKey = parts[1].split('T')[0]
          statsData.sessionDaySeen[sid + ':' + dayKey] = true
        }
        delete statsData.sessionHourSeen
      }
    } catch (err) {
      console.error("[stats] loadStats: FAILED:", err.message)
      try {
        const raw = readFileSync(statsPath, "utf8")
        const partial = raw.slice(0, raw.lastIndexOf("}") + 1) + "}"
        const recovered = JSON.parse(partial)
        statsData = { ...defaults, ...recovered }
        console.error("[stats] loadStats: partially recovered")
        saveStats()
      } catch {
        console.error("[stats] loadStats: recovery failed, starting with defaults")
        try { copyFileSync(statsPath, statsPath + ".bak") } catch {}
        statsData = { ...defaults }
        saveStats()
      }
    }
  } else {
    console.log("[stats] loadStats: file not found, starting with defaults")
    statsData = { ...defaults }
    saveStats()
  }
}

const getDayKey = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const ensureDayStats = (dayKey) => {
  if (!statsData.dailyStats[dayKey]) {
    statsData.dailyStats[dayKey] = { activeClients: 0, activeSessions: 0, processingSessions: 0, newSessions: 0, messagesSent: 0 }
  } else if (!statsData.dailyStats[dayKey].messagesSent) {
    statsData.dailyStats[dayKey].messagesSent = 0
  }
}

const parseDayKey = (dayKey) => {
  const [y, m, d] = dayKey.split("-")
  return new Date(Number(y), Number(m) - 1, Number(d)).getTime()
}

const cleanupOldStats = () => {
  const oneYearAgo = Date.now() - 365 * 24 * 3600000
  const removedKeys = []
  for (const key of Object.keys(statsData.dailyStats)) {
    const dayTs = parseDayKey(key)
    if (dayTs < oneYearAgo) {
      removedKeys.push(key)
      delete statsData.dailyStats[key]
    }
  }
  for (const k of Object.keys(statsData.clientDaySeen)) {
    const dayKey = k.split(":").pop()
    if (removedKeys.includes(dayKey)) delete statsData.clientDaySeen[k]
  }
  for (const k of Object.keys(statsData.sessionDaySeen)) {
    const dayKey = k.split(":").pop()
    if (removedKeys.includes(dayKey)) delete statsData.sessionDaySeen[k]
  }
}

loadStats()
cleanupOldStats()
saveStats()

let statsDirty = false
let statsDirtyTimer = null
const markDirty = () => {
  statsDirty = true
  if (!statsDirtyTimer) {
    statsDirtyTimer = setTimeout(() => {
      if (statsDirty) { saveStats(); statsDirty = false }
      statsDirtyTimer = null
    }, 60000)
  }
}
const saveInterval = setInterval(() => { if (statsDirty) { saveStats(); statsDirty = false } }, 300000)
const cleanupInterval = setInterval(cleanupOldStats, 86400000)

const gracefulShutdown = () => {
  clearInterval(saveInterval)
  clearInterval(cleanupInterval)
  if (statsDirtyTimer) clearTimeout(statsDirtyTimer)
  saveStats()
  process.exit(0)
}
process.on("SIGINT", gracefulShutdown)
process.on("SIGTERM", gracefulShutdown)

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
}

async function readBody(req) {
  const buffer = await req.arrayBuffer()
  return Buffer.from(buffer).toString()
}

async function handleAPI(req, server) {
  const url = new URL(req.url, "http://localhost")
  const method = req.method

  if (url.pathname === "/device/info" && method === "GET") {
    const contactAdmin = process.env.VITE_CONTACT_ADMIN || ""
    const contactList = contactAdmin.split('|').filter(line => line.trim())
    return jsonResponse({
      clientIP: getClientIP(req, server),
      contactAdmin: contactList,
      feedbackUrl: process.env.VITE_FEEDBACK_URL || "",
      caseLibraryDir: process.env.VITE_CASE_LIBRARY_DIR || "",
      helpDocUrl: process.env.VITE_HELP_DOC_URL || "",
      announcementText: process.env.VITE_ANNOUNCEMENT_TEXT || "",
      downloadCutoffText: process.env.VITE_DOWNLOAD_CUTOFF_TEXT || "",
    })
  }

  if (url.pathname.startsWith("/directory/create") && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { path: targetPath } = body
      if (!targetPath) return jsonResponse({ error: "Missing path" }, 400)
      if (!existsSync(targetPath)) mkdirSync(targetPath, { recursive: true })
      return jsonResponse({ success: true, path: targetPath })
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  if (url.pathname.startsWith("/api/case-library/list") && method === "GET") {
    try {
      const caseLibraryDir = process.env.VITE_CASE_LIBRARY_DIR || ""
      if (!caseLibraryDir || !existsSync(caseLibraryDir)) return jsonResponse({ files: [] })
      const subPath = url.searchParams.get("path") || ""
      const targetDir = subPath ? join(caseLibraryDir, subPath) : caseLibraryDir
      if (!existsSync(targetDir)) return jsonResponse({ files: [], dirs: [] })
      const files = []
      const dirs = []
      const entries = readdirSync(targetDir, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = subPath ? `${subPath}/${entry.name}` : entry.name
        if (entry.isSymbolicLink()) {
          try {
            const linkPath = join(targetDir, entry.name)
            const realPath = realpathSync(linkPath)
            const stat = statSync(realPath)
            if (stat.isDirectory()) dirs.push({ name: entry.name, path: entryPath })
            else files.push({ name: entry.name, path: entryPath })
          } catch { files.push({ name: entry.name, path: entryPath }) }
        } else if (entry.isDirectory()) {
          dirs.push({ name: entry.name, path: entryPath })
        } else if (entry.isFile()) {
          files.push({ name: entry.name, path: entryPath })
        }
      }
      return jsonResponse({ files, dirs })
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  if (url.pathname.startsWith("/api/case-library/read") && method === "GET") {
    try {
      const caseLibraryDir = process.env.VITE_CASE_LIBRARY_DIR || ""
      if (!caseLibraryDir) return jsonResponse({ error: "Case library not configured" }, 400)
      const filePath = url.searchParams.get("path")
      if (!filePath) return jsonResponse({ error: "Missing path" }, 400)
      const fullPath = join(caseLibraryDir, filePath)
      if (!existsSync(fullPath)) return jsonResponse({ error: "File not found" }, 404)
      const content = readFileSync(fullPath, "utf-8")
      return jsonResponse({ content })
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  if (url.pathname.startsWith("/file/upload") && method === "POST") {
    try {
      const directory = url.searchParams.get("directory")
      if (directory) {
        try {
          const dfOutput = execSync(`df "${directory}" --output=pcent`, { encoding: "utf8" }).trim()
          const lines = dfOutput.split("\n")
          const usePercent = parseInt(lines[1]?.trim().replace("%", ""), 10)
          if (usePercent >= 90) {
            return jsonResponse({ error: `磁盘使用率 ${usePercent}%，超过90%阈值，无法上传文件，请联系管理员！` }, 507)
          }
        } catch {}
      }
      if (!directory) return jsonResponse({ error: "Missing directory" }, 400)

      const boundary = req.headers.get("content-type")?.split("boundary=")[1]
      if (!boundary) return jsonResponse({ error: "Missing boundary" }, 400)

      const boundaryBuffer = Buffer.from(`--${boundary}`)
      const chunks = []
      const reader = req.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const buffer = Buffer.concat(chunks)

      const boundaryPositions = []
      let pos = 0
      while (pos < buffer.length) {
        const idx = buffer.indexOf(boundaryBuffer, pos)
        if (idx === -1) break
        boundaryPositions.push(idx)
        pos = idx + boundaryBuffer.length
      }

      let fileContent = null
      let filePath = null
      for (let i = 0; i < boundaryPositions.length - 1; i++) {
        const start = boundaryPositions[i] + boundaryBuffer.length
        const end = boundaryPositions[i + 1]
        const part = buffer.slice(start, end)
        const nameMatch = part.indexOf(Buffer.from('name="file"'))
        if (nameMatch !== -1) {
          const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
          if (headerEnd !== -1) {
            fileContent = part.slice(headerEnd + 4, part.length - 2)
          }
        }
        const pathMatch = part.indexOf(Buffer.from('name="path"'))
        if (pathMatch !== -1) {
          const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
          if (headerEnd !== -1) {
            filePath = part.slice(headerEnd + 4, part.length - 2).toString().trim()
          }
        }
      }

      if (!fileContent || !filePath) return jsonResponse({ error: "Missing file or path" }, 400)

      const fullPath = filePath.startsWith("/") ? filePath : join(directory, filePath)
      const dir = dirname(fullPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

      const tmpPath = fullPath + '.tmp'
      writeFileSync(tmpPath, fileContent)
      renameSync(tmpPath, fullPath)

      return jsonResponse({ success: true, path: fullPath })
    } catch (error) {
      console.error("[upload] error:", error.message)
      return jsonResponse({ error: error.message }, 500)
    }
  }

  if (url.pathname.startsWith("/file/download") && method === "GET") {
    try {
      const filePath = url.searchParams.get("path")
      const directory = url.searchParams.get("directory")
      if (!filePath) return jsonResponse({ error: "Missing path" }, 400)
      if (!directory) return jsonResponse({ error: "Missing directory" }, 400)
      const fullPath = filePath.startsWith("/") ? filePath : join(directory, filePath)
      if (!existsSync(fullPath)) return jsonResponse({ error: "File not found" }, 404)
      const stats = statSync(fullPath)
      if (stats.isDirectory()) return jsonResponse({ error: "Path is a directory, not a file" }, 400)
      const fileContent = readFileSync(fullPath)
      const filename = filePath.split("/").pop() || "download"
      return new Response(fileContent, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Content-Length": fileContent.length,
        },
      })
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  if (url.pathname.startsWith("/file/delete") && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { path: filePath } = body
      if (!filePath) return jsonResponse({ error: "Missing path" }, 400)
      const directory = url.searchParams.get("directory")
      if (!directory) return jsonResponse({ error: "Missing directory" }, 400)
      const fullPath = filePath.startsWith("/") ? filePath : join(directory, filePath)
      if (!existsSync(fullPath)) return jsonResponse({ error: "File not found" }, 404)
      const stats = statSync(fullPath)
      if (stats.isDirectory()) {
        const deleteDir = (dirPath) => {
          const entries = readdirSync(dirPath, { withFileTypes: true })
          for (const entry of entries) {
            const entryPath = join(dirPath, entry.name)
            if (entry.isDirectory()) deleteDir(entryPath)
            else unlinkSync(entryPath)
          }
          rmdirSync(dirPath)
        }
        deleteDir(fullPath)
      } else {
        unlinkSync(fullPath)
      }
      return jsonResponse({ success: true })
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  if (url.pathname === "/api/stats/heartbeat" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { clientIP, sessions, totalExistingSessions, timestamp } = body
      if (!clientIP) return jsonResponse({ error: "Missing clientIP" }, 400)
      if (!statsData.heartbeats[clientIP]) {
        statsData.totalClientsEver++
        statsData.heartbeats[clientIP] = { lastSeen: timestamp, sessions: {} }
      }
      statsData.heartbeats[clientIP].lastSeen = timestamp
      const reportedSessionIDs = new Set((sessions || []).map(s => s.sessionID))
      for (const sid of Object.keys(statsData.heartbeats[clientIP].sessions || {})) {
        if (!reportedSessionIDs.has(sid) && (statsData.heartbeats[clientIP].sessions[sid].status === "busy" || statsData.heartbeats[clientIP].sessions[sid].status === "retry")) {
          statsData.heartbeats[clientIP].sessions[sid].status = "idle"
        }
      }
      if (sessions && Array.isArray(sessions)) {
        for (const s of sessions) {
          if (!statsData.heartbeats[clientIP].sessions[s.sessionID]) {
            statsData.heartbeats[clientIP].sessions[s.sessionID] = { status: s.status, lastSeen: timestamp }
            statsData.totalSessionsEverCreated++
            statsData.totalSessionsCurrent++
          } else {
            statsData.heartbeats[clientIP].sessions[s.sessionID].status = s.status
            statsData.heartbeats[clientIP].sessions[s.sessionID].lastSeen = timestamp
          }
        }
      }
      const dayKey = getDayKey(timestamp)
      ensureDayStats(dayKey)
      const clientDayKey = `${clientIP}:${dayKey}`
      if (!statsData.clientDaySeen[clientDayKey]) {
        statsData.clientDaySeen[clientDayKey] = true
        statsData.dailyStats[dayKey].activeClients++
      }
      if (sessions && Array.isArray(sessions)) {
        for (const s of sessions) {
          const sessionDayKey = `${s.sessionID}:${dayKey}`
          if (!statsData.sessionDaySeen[sessionDayKey]) {
            statsData.sessionDaySeen[sessionDayKey] = true
            statsData.dailyStats[dayKey].activeSessions++
            if (s.status === "busy" || s.status === "retry") statsData.dailyStats[dayKey].processingSessions++
          }
        }
      }
      markDirty()
      return jsonResponse({ ok: true })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname === "/api/stats/session-init" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { clientIP, allSessionIDs, timestamp } = body
      if (!clientIP) return jsonResponse({ error: "Missing clientIP" }, 400)
      if (!statsData.heartbeats[clientIP]) {
        statsData.totalClientsEver++
        statsData.heartbeats[clientIP] = { lastSeen: timestamp, sessions: {} }
      }
      statsData.heartbeats[clientIP].lastSeen = timestamp
      const dayKey = getDayKey(timestamp)
      ensureDayStats(dayKey)
      const clientDayKey = `${clientIP}:${dayKey}`
      if (!statsData.clientDaySeen[clientDayKey]) {
        statsData.clientDaySeen[clientDayKey] = true
        statsData.dailyStats[dayKey].activeClients++
      }
      if (allSessionIDs && Array.isArray(allSessionIDs)) {
        for (const sid of allSessionIDs) {
          if (!statsData.heartbeats[clientIP].sessions[sid]) {
            statsData.heartbeats[clientIP].sessions[sid] = { status: "idle", lastSeen: timestamp }
            statsData.totalSessionsEverCreated++
            statsData.totalSessionsCurrent++
          }
          const sessionDayKey = `${sid}:${dayKey}`
          if (!statsData.sessionDaySeen[sessionDayKey]) {
            statsData.sessionDaySeen[sessionDayKey] = true
            statsData.dailyStats[dayKey].activeSessions++
          }
        }
      }
      markDirty()
      return jsonResponse({ ok: true })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname === "/api/stats/session-create" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { clientIP, sessionID, timestamp } = body
      if (!clientIP || !sessionID) return jsonResponse({ error: "Missing clientIP or sessionID" }, 400)
      if (!statsData.heartbeats[clientIP]) {
        statsData.totalClientsEver++
        statsData.heartbeats[clientIP] = { lastSeen: timestamp, sessions: {} }
      }
      if (!statsData.heartbeats[clientIP].sessions[sessionID]) {
        statsData.heartbeats[clientIP].sessions[sessionID] = { status: "idle", lastSeen: timestamp }
        statsData.totalSessionsEverCreated++
        statsData.totalSessionsCurrent++
      }
      const dayKey = getDayKey(timestamp)
      ensureDayStats(dayKey)
      statsData.dailyStats[dayKey].newSessions++
      markDirty()
      return jsonResponse({ ok: true })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname === "/api/stats/session-delete" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { sessionID } = body
      if (!sessionID) return jsonResponse({ error: "Missing sessionID" }, 400)
      let found = false
      for (const ip of Object.keys(statsData.heartbeats)) {
        if (statsData.heartbeats[ip].sessions?.[sessionID]) {
          delete statsData.heartbeats[ip].sessions[sessionID]
          found = true
        }
      }
      if (found) statsData.totalSessionsCurrent = Math.max(0, statsData.totalSessionsCurrent - 1)
      markDirty()
      return jsonResponse({ ok: true })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname === "/api/stats/message-send" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { sessionID, timestamp } = body
      if (!sessionID) return jsonResponse({ error: "Missing sessionID" }, 400)
      statsData.totalMessagesEver++
      const dayKey = getDayKey(timestamp)
      ensureDayStats(dayKey)
      statsData.dailyStats[dayKey].messagesSent++
      markDirty()
      return jsonResponse({ ok: true })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname.startsWith("/api/stats") && method === "GET") {
    if (!adminToken) return jsonResponse({ error: "VITE_STATS_ADMIN_TOKEN not configured" }, 403)
    const token = url.searchParams.get("token")
    if (token !== adminToken) return jsonResponse({ error: "Invalid token" }, 403)

    const now = Date.now()
    const tenMinAgo = now - 600000

    try {
      const baseDir = envVars.VITE_OPENCODE_DEFAULT_DIR || process.cwd()
      const directories = new Set()
      for (const ip of Object.keys(statsData.heartbeats)) {
        if (statsData.heartbeats[ip].lastSeen < tenMinAgo) continue
        for (const sid of Object.keys(statsData.heartbeats[ip].sessions || {})) {
          const s = statsData.heartbeats[ip].sessions[sid]
          if (s.status === "busy" || s.status === "retry") {
            directories.add(`${baseDir}/${ip}`)
            break
          }
        }
      }
      const allRealStatuses = {}
      for (const dir of directories) {
        try {
          const res = await fetch(`${serverUrl}/session/status?directory=${encodeURIComponent(dir)}`, {
            signal: AbortSignal.timeout(5000),
            headers: serverAuthHeader ? { Authorization: serverAuthHeader } : {},
          })
          if (res.ok) {
            const map = await res.json()
            Object.assign(allRealStatuses, map)
          }
        } catch (err) {
          console.error(`[stats] failed to query status for directory ${dir}: ${err.message}`)
        }
      }
      for (const ip of Object.keys(statsData.heartbeats)) {
        if (statsData.heartbeats[ip].lastSeen < tenMinAgo) continue
        for (const sid of Object.keys(statsData.heartbeats[ip].sessions || {})) {
          const s = statsData.heartbeats[ip].sessions[sid]
          if (s.status !== "busy" && s.status !== "retry") continue
          const real = allRealStatuses[sid]
          s.status = real ? real.type : "idle"
        }
      }
      markDirty()
    } catch (err) {
      console.error(`[stats] failed to align session status: ${err.message}`)
    }
    let onlineClients = 0
    let onlineSessions = 0
    let processingSessions = 0
    const currentSessions = []
    for (const [ip, hb] of Object.entries(statsData.heartbeats)) {
      if (hb.lastSeen >= tenMinAgo) onlineClients++
      for (const [sid, s] of Object.entries(hb.sessions || {})) {
        if (s.lastSeen >= tenMinAgo) {
          onlineSessions++
          if (s.status === "busy" || s.status === "retry") processingSessions++
          const d = new Date(s.lastSeen)
          const pad = (n) => String(n).padStart(2, "0")
          currentSessions.push({
            sessionID: sid,
            clientIP: ip,
            lastSeen: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
            status: s.status,
          })
        }
      }
    }
    const statusSortOrder = { busy: 0, retry: 1, idle: 2 }
    currentSessions.sort((a, b) => (statusSortOrder[a.status] ?? 3) - (statusSortOrder[b.status] ?? 3))
    const yearlyDaysAgo = new Date(now - 365 * 86400000)
    const dailyTrend = Object.entries(statsData.dailyStats)
      .filter(([key]) => parseDayKey(key) >= yearlyDaysAgo.getTime())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({ day: key, ...val }))
    return jsonResponse({
      summary: {
        totalClientsEver: statsData.totalClientsEver,
        onlineClients,
        totalSessionsEverCreated: statsData.totalSessionsEverCreated,
        totalSessionsCurrent: statsData.totalSessionsCurrent,
        totalMessagesEver: statsData.totalMessagesEver,
        onlineSessions,
        processingSessions,
      },
      currentSessions,
      dailyTrend,
      clientDaySeen: statsData.clientDaySeen,
      sessionDaySeen: statsData.sessionDaySeen,
    })
  }

  if (url.pathname.startsWith("/api/config/runtime") && method === "GET") {
    if (!adminToken) return jsonResponse({ error: "VITE_STATS_ADMIN_TOKEN not configured" }, 403)
    const token = url.searchParams.get("token")
    if (token !== adminToken) return jsonResponse({ error: "Invalid token" }, 403)
    return jsonResponse({
      announcementText: process.env.VITE_ANNOUNCEMENT_TEXT || "",
      contactAdmin: process.env.VITE_CONTACT_ADMIN || "",
      feedbackUrl: process.env.VITE_FEEDBACK_URL || "",
      helpDocUrl: process.env.VITE_HELP_DOC_URL || "",
      downloadCutoffText: process.env.VITE_DOWNLOAD_CUTOFF_TEXT || "",
    })
  }

  if (url.pathname.startsWith("/api/config/runtime") && method === "PATCH") {
    if (!adminToken) return jsonResponse({ error: "VITE_STATS_ADMIN_TOKEN not configured" }, 403)
    const token = url.searchParams.get("token")
    if (token !== adminToken) return jsonResponse({ error: "Invalid token" }, 403)
    try {
      const body = JSON.parse(await readBody(req))
      const envMap = {
        announcementText: "VITE_ANNOUNCEMENT_TEXT",
        contactAdmin: "VITE_CONTACT_ADMIN",
        feedbackUrl: "VITE_FEEDBACK_URL",
        helpDocUrl: "VITE_HELP_DOC_URL",
        downloadCutoffText: "VITE_DOWNLOAD_CUTOFF_TEXT",
      }
      for (const [key, envKey] of Object.entries(envMap)) {
        if (body[key] !== undefined) process.env[envKey] = body[key] || ""
      }
      let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : ""
      const envLines = envContent.split("\n")
      const updatedLines = [...envLines]
      for (const [key, envKey] of Object.entries(envMap)) {
        if (body[key] === undefined) continue
        const value = body[key] || ""
        const line = `${envKey}="${value}"`
        const idx = updatedLines.findIndex(l => l.startsWith(`${envKey}=`))
        if (idx >= 0) updatedLines[idx] = line
        else updatedLines.push(line)
      }
      writeFileSync(envPath, updatedLines.filter(l => l.trim()).join("\n") + "\n", "utf-8")
      return jsonResponse({ success: true })
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  return null
}

Bun.serve({
  hostname: webHost,
  port: webPort,
  idleTimeout: 255,
  maxRequestBodySize: Number.MAX_SAFE_INTEGER,
  async fetch(req, server) {
    const url = new URL(req.url, "http://localhost")
    const start = Date.now()
    console.log(`[request] ${req.method} ${url.pathname}${url.search}`)

    try {
      const apiRes = await handleAPI(req, server)
      if (apiRes) {
        console.log(`[response] ${req.method} ${url.pathname} -> middleware ${apiRes.status} ${Date.now() - start}ms`)
        return apiRes
      }

      const staticResult = serveStatic(url.pathname)
      if (staticResult) {
        console.log(`[response] ${req.method} ${url.pathname} -> static ${Date.now() - start}ms`)
        return new Response(staticResult.content, { headers: { "Content-Type": staticResult.mime } })
      }

      const indexPath = join(distDir, 'index.html')
      if (existsSync(indexPath)) {
        console.log(`[response] ${req.method} ${url.pathname} -> spa-fallback ${Date.now() - start}ms`)
        return new Response(readFileSync(indexPath), { headers: { "Content-Type": "text/html" } })
      }

      console.log(`[response] ${req.method} ${url.pathname} -> 404 ${Date.now() - start}ms`)
      return new Response("Not Found", { status: 404 })
    } catch (error) {
      console.error(`[error] ${req.method} ${url.pathname} -> ${error.message}`)
      return jsonResponse({ error: error.message }, 500)
    }
  },
})

const logPath = envVars.LOG_PATH || "/tmp/opencode-extend.log"
const MAX_LOG_SIZE = 50 * 1024 * 1024
const rotateLog = () => {
  try {
    if (!existsSync(logPath)) return
    const size = statSync(logPath).size
    if (size < MAX_LOG_SIZE) return
    for (let i = 5; i >= 1; i--) {
      const oldPath = `${logPath}.${i}`
      const newPath = `${logPath}.${i + 1}`
      if (i === 5) { try { unlinkSync(oldPath) } catch {} }
      else { try { renameSync(oldPath, newPath) } catch {} }
    }
    try { renameSync(logPath, `${logPath}.1`) } catch {}
    console.log(`[log] rotated, previous size: ${(size / 1024 / 1024).toFixed(1)}MB`)
  } catch {}
}
setInterval(rotateLog, 600000)
rotateLog()

console.log(`[server] Production server listening on ${webHost}:${webPort}`)
console.log(`[server] Static files from: ${distDir}`)
console.log(`[server] Stats data: ${statsPath}`)
