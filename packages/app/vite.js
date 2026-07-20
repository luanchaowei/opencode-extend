import { readFileSync, writeFileSync, createWriteStream, mkdirSync, existsSync, unlinkSync, statSync, readdirSync, rmdirSync, realpathSync, renameSync, copyFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { execSync } from "node:child_process"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

function getClientIP(req) {
  // 如果有代理，从 x-forwarded-for 获取
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim()
    // 去掉冒号（IPv6），点号改为下划线（IPv4）
    return ip.replace(/:/g, '').replace(/\./g, '_')
  }
  
  // 直连时从 socket 获取
  const remoteAddress = req.socket?.remoteAddress
  if (remoteAddress) {
    // 处理 IPv6 映射的 IPv4 地址 (::ffff:192.168.1.1)
    if (remoteAddress.startsWith('::ffff:')) {
      const ipv4 = remoteAddress.substring(7)  // 提取 IPv4 部分
      return ipv4.replace(/\./g, '_')  // 点号改为下划线
    }
    // 本地回环地址统一为 localhost
    if (remoteAddress === '::1' || remoteAddress === '127.0.0.1') {
      return 'localhost'
    }
    // 去掉冒号（IPv6），点号改为下划线（IPv4）
    return remoteAddress.replace(/:/g, '').replace(/\./g, '_')
  }
  
  return 'unknown'
}

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "opencode-desktop:device-info-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/device/info") && req.method === "GET") {
          try {
            const clientIP = getClientIP(req)
            const contactAdmin = process.env.VITE_CONTACT_ADMIN || ""
            const contactList = contactAdmin.split('|').filter(line => line.trim())
            const feedbackUrl = process.env.VITE_FEEDBACK_URL || ""
            const caseLibraryDir = process.env.VITE_CASE_LIBRARY_DIR || ""
            res.setHeader("Content-Type", "application/json")
            const helpDocUrl = process.env.VITE_HELP_DOC_URL || ""
            const announcementText = process.env.VITE_ANNOUNCEMENT_TEXT || ""
            const downloadCutoffText = process.env.VITE_DOWNLOAD_CUTOFF_TEXT || ""
            const fileTreePollInterval = process.env.VITE_FILE_TREE_POLL_INTERVAL || "5000"
            const heartbeatInterval = process.env.VITE_HEARTBEAT_INTERVAL || "60000"
            const diskUsageThreshold = process.env.VITE_DISK_USAGE_THRESHOLD || "90"
            res.end(JSON.stringify({ clientIP, contactAdmin: contactList, feedbackUrl, caseLibraryDir, helpDocUrl, announcementText, downloadCutoffText, fileTreePollInterval, heartbeatInterval, diskUsageThreshold }))
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        } else {
          next()
        }
      })
    },
  },
  {
    name: "opencode-desktop:directory-create-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/directory/create") && req.method === "POST") {
          try {
            const chunks = []
            for await (const chunk of req) {
              chunks.push(chunk)
            }
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const { path: targetPath } = body
            
            if (!targetPath) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing path" }))
              return
            }
            
            if (!existsSync(targetPath)) {
              mkdirSync(targetPath, { recursive: true })
            }
            
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ success: true, path: targetPath }))
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        } else {
          next()
        }
      })
    },
  },
  {
    name: "opencode-desktop:case-library-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/api/case-library/list") && req.method === "GET") {
          try {
            const caseLibraryDir = process.env.VITE_CASE_LIBRARY_DIR || ""
            res.setHeader("Content-Type", "application/json")
            if (!caseLibraryDir || !existsSync(caseLibraryDir)) {
              res.end(JSON.stringify({ files: [] }))
              return
            }
            
            const urlObj = new URL(req.url, `http://${req.headers.host}`)
            const subPath = urlObj.searchParams.get("path") || ""
            const targetDir = subPath ? join(caseLibraryDir, subPath) : caseLibraryDir
            
            if (!existsSync(targetDir)) {
              res.end(JSON.stringify({ files: [], dirs: [] }))
              return
            }
            
            const files = []
            const dirs = []
            const entries = readdirSync(targetDir, { withFileTypes: true })
            for (const entry of entries) {
              if (entry.isSymbolicLink()) {
                try {
                  const linkPath = join(targetDir, entry.name)
                  const realPath = realpathSync(linkPath)
                  const stat = statSync(realPath)
                  if (stat.isDirectory()) {
                    dirs.push({ name: entry.name, path: subPath ? `${subPath}/${entry.name}` : entry.name })
                  } else {
                    files.push({ name: entry.name, path: subPath ? `${subPath}/${entry.name}` : entry.name })
                  }
                } catch {
                  files.push({ name: entry.name, path: subPath ? `${subPath}/${entry.name}` : entry.name })
                }
              } else if (entry.isDirectory()) {
                dirs.push({ name: entry.name, path: subPath ? `${subPath}/${entry.name}` : entry.name })
              } else if (entry.isFile()) {
                files.push({ name: entry.name, path: subPath ? `${subPath}/${entry.name}` : entry.name })
              }
            }
            
            res.end(JSON.stringify({ files, dirs }))
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        } else if (req.url?.startsWith("/api/case-library/read") && req.method === "GET") {
          try {
            const caseLibraryDir = process.env.VITE_CASE_LIBRARY_DIR || ""
            res.setHeader("Content-Type", "application/json")
            if (!caseLibraryDir) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Case library not configured" }))
              return
            }
            
            const urlObj = new URL(req.url, `http://${req.headers.host}`)
            const filePath = urlObj.searchParams.get("path")
            if (!filePath) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing path" }))
              return
            }
            
            const fullPath = join(caseLibraryDir, filePath)
            if (!existsSync(fullPath)) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: "File not found" }))
              return
            }
            
            const content = readFileSync(fullPath, "utf-8")
            res.end(JSON.stringify({ content }))
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        } else {
          next()
        }
      })
    },
  },
  {
    name: "opencode-desktop:file-upload-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/file/upload") && req.method === "POST") {
          const TIMEOUT_MS = 5 * 60 * 1000
          const timeoutId = setTimeout(() => {
            if (!res.headersSent) {
              res.statusCode = 408
              res.end(JSON.stringify({ error: "Upload timeout" }))
            }
            req.destroy()
          }, TIMEOUT_MS)

          let clientAborted = false
          req.on('aborted', () => {
            clientAborted = true
            clearTimeout(timeoutId)
          })
          req.on('error', (err) => {
            console.error("[upload] req error:", err.message)
            clientAborted = true
            clearTimeout(timeoutId)
          })

          let tmpPath = null

          try {
            const query = new URL(req.url, "http://localhost").searchParams
            const directory = query.get("directory")
            if (directory) {
              try {
                const dfOutput = execSync(`df "${directory}" --output=pcent`, { encoding: "utf8" }).trim()
                const lines = dfOutput.split("\n")
                const usePercent = parseInt(lines[1]?.trim().replace("%", ""), 10)
                if (usePercent >= 90) {
                  clearTimeout(timeoutId)
                  res.statusCode = 507
                  res.end(JSON.stringify({ error: `磁盘使用率 ${usePercent}%，超过90%阈值，无法上传文件，请联系管理员！` }))
                  return
                }
              } catch {}
            }

            if (!directory) {
              clearTimeout(timeoutId)
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing directory" }))
              return
            }

            const boundary = req.headers["content-type"]?.split("boundary=")[1]
            if (!boundary) {
              clearTimeout(timeoutId)
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing boundary" }))
              return
            }

            const boundaryBuffer = Buffer.from(`--${boundary}`)
            const chunks = []
            let totalSize = 0
            const MAX_SIZE = 1024 * 1024 * 1024

            for await (const chunk of req) {
              if (clientAborted) {
                clearTimeout(timeoutId)
                return
              }
              totalSize += chunk.length
              if (totalSize > MAX_SIZE) {
                clearTimeout(timeoutId)
                res.statusCode = 413
                res.end(JSON.stringify({ error: "File too large (max 1GB)" }))
                return
              }
              chunks.push(chunk)
            }

            if (clientAborted) {
              clearTimeout(timeoutId)
              return
            }

            clearTimeout(timeoutId)
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
                  const contentStart = headerEnd + 4
                  const contentEnd = part.length - 2
                  fileContent = part.slice(contentStart, contentEnd)
                }
              }

              const pathMatch = part.indexOf(Buffer.from('name="path"'))
              if (pathMatch !== -1) {
                const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
                if (headerEnd !== -1) {
                  const contentStart = headerEnd + 4
                  const contentEnd = part.length - 2
                  filePath = part.slice(contentStart, contentEnd).toString().trim()
                }
              }
            }

            if (!fileContent || !filePath) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing file or path" }))
              return
            }

            const fullPath = filePath.startsWith("/") ? filePath : join(directory, filePath)
            const dir = dirname(fullPath)

            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true })
            }

            tmpPath = fullPath + '.tmp'
            writeFileSync(tmpPath, fileContent)
            renameSync(tmpPath, fullPath)
            tmpPath = null

            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ success: true, path: fullPath }))
          } catch (error) {
            console.error("[upload] error:", error.message)
            clearTimeout(timeoutId)
            if (clientAborted) return
            if (tmpPath) {
              try { if (existsSync(tmpPath)) unlinkSync(tmpPath) } catch {}
            }
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        } else {
          next()
        }
      })
    },
  },
  {
    name: "opencode-desktop:file-download-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/file/download") && req.method === "GET") {
          try {
            const query = new URL(req.url, "http://localhost").searchParams
            const filePath = query.get("path")
            const directory = query.get("directory")
            
            if (!filePath) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing path" }))
              return
            }
            
            if (!directory) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing directory" }))
              return
            }
            
            const fullPath = filePath.startsWith("/") ? filePath : join(directory, filePath)
            
            if (!existsSync(fullPath)) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: "File not found" }))
              return
            }
            
            const stats = statSync(fullPath)
            if (stats.isDirectory()) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Path is a directory, not a file" }))
              return
            }
            
            const fileContent = readFileSync(fullPath)
            const filename = filePath.split("/").pop() || "download"
            const encodedFilename = encodeURIComponent(filename)
            
            res.setHeader("Content-Type", "application/octet-stream")
            res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodedFilename}`)
            res.setHeader("Content-Length", fileContent.length)
            res.end(fileContent)
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        } else {
          next()
        }
      })
    },
  },
  {
    name: "opencode-desktop:file-delete-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith("/file/delete") && req.method === "POST") {
          try {
            const chunks = []
            for await (const chunk of req) {
              chunks.push(chunk)
            }
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const { path: filePath } = body
            
            if (!filePath) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing path" }))
              return
            }
            
            const query = new URL(req.url, "http://localhost").searchParams
            const directory = query.get("directory")
            
            if (!directory) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: "Missing directory" }))
              return
            }
            
            const fullPath = filePath.startsWith("/") ? filePath : join(directory, filePath)
            
            if (!existsSync(fullPath)) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: "File not found" }))
              return
            }
            
            const stats = statSync(fullPath)
            
            if (stats.isDirectory()) {
              // Recursively delete directory
              const deleteDir = (dirPath) => {
                const entries = readdirSync(dirPath, { withFileTypes: true })
                for (const entry of entries) {
                  const fullPath = join(dirPath, entry.name)
                  if (entry.isDirectory()) {
                    deleteDir(fullPath)
                  } else {
                    unlinkSync(fullPath)
                  }
                }
                rmdirSync(dirPath)
              }
              deleteDir(fullPath)
            } else {
              unlinkSync(fullPath)
            }
            
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ success: true }))
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        } else {
          next()
        }
      })
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  tailwindcss(),
  solidPlugin(),
  {
    name: "opencode-desktop:stats-api",
    configureServer(server) {
      const statsDir = process.env.VITE_STATS_DATA_PATH || dirname(fileURLToPath(import.meta.url))
      const statsPath = join(statsDir, "stats.json")
      const adminToken = process.env.VITE_STATS_ADMIN_TOKEN || ""

const defaults = { heartbeats: {}, totalClientsEver: 0, totalSessionsEverCreated: 0, totalMessagesEver: 0, dailyStats: {}, clientDaySeen: {}, sessionDaySeen: {} }
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
            console.error("[stats] loadStats: FAILED to parse stats.json:", err.message)
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

      server.middlewares.use(async (req, res, next) => {
        const readBody = async () => {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          return Buffer.concat(chunks).toString()
        }

        if (req.url === "/api/stats/heartbeat" && req.method === "POST") {
          try {
            const body = JSON.parse(await readBody())
            const { clientIP, sessions, timestamp } = body
            if (!clientIP) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing clientIP" })); return }

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
                if (statsData.heartbeats[clientIP].sessions[s.sessionID]) {
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
                if (!statsData.heartbeats[clientIP].sessions[s.sessionID]) continue
                const sessionDayKey = `${s.sessionID}:${dayKey}`
                if (!statsData.sessionDaySeen[sessionDayKey]) {
                  statsData.sessionDaySeen[sessionDayKey] = true
                  statsData.dailyStats[dayKey].activeSessions++
                  if (s.status === "busy" || s.status === "retry") statsData.dailyStats[dayKey].processingSessions++
                }
              }
            }

            markDirty()
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        if (req.url === "/api/stats/session-init" && req.method === "POST") {
          try {
            const body = JSON.parse(await readBody())
            const { clientIP, allSessionIDs, timestamp } = body
            if (!clientIP) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing clientIP" })); return }

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
                }
                const sessionDayKey = `${sid}:${dayKey}`
                if (!statsData.sessionDaySeen[sessionDayKey]) {
                  statsData.sessionDaySeen[sessionDayKey] = true
                  statsData.dailyStats[dayKey].activeSessions++
                }
              }
            }

            markDirty()
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        if (req.url === "/api/stats/session-create" && req.method === "POST") {
          try {
            const body = JSON.parse(await readBody())
            const { clientIP, sessionID, timestamp } = body
            if (!clientIP || !sessionID) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing clientIP or sessionID" })); return }

            if (!statsData.heartbeats[clientIP]) {
              statsData.totalClientsEver++
              statsData.heartbeats[clientIP] = { lastSeen: timestamp, sessions: {} }
            }
            if (!statsData.heartbeats[clientIP].sessions[sessionID]) {
              statsData.heartbeats[clientIP].sessions[sessionID] = { status: "idle", lastSeen: timestamp }
              statsData.totalSessionsEverCreated++
              const dayKey = getDayKey(timestamp)
              ensureDayStats(dayKey)
              statsData.dailyStats[dayKey].newSessions++
            }

            markDirty()
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        if (req.url === "/api/stats/session-delete" && req.method === "POST") {
          try {
            const body = JSON.parse(await readBody())
            const { sessionID } = body
            if (!sessionID) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing sessionID" })); return }

            for (const ip of Object.keys(statsData.heartbeats)) {
              if (statsData.heartbeats[ip].sessions?.[sessionID]) {
                delete statsData.heartbeats[ip].sessions[sessionID]
              }
            }

            markDirty()
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        if (req.url === "/api/stats/message-send" && req.method === "POST") {
          try {
            const body = JSON.parse(await readBody())
            const { sessionID, timestamp } = body
            if (!sessionID) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing sessionID" })); return }

            statsData.totalMessagesEver++
            const dayKey = getDayKey(timestamp)
            ensureDayStats(dayKey)
            statsData.dailyStats[dayKey].messagesSent++

            markDirty()
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        if (req.url?.startsWith("/api/stats") && req.method === "GET") {
          if (!adminToken) {
            res.statusCode = 403; res.end(JSON.stringify({ error: "VITE_STATS_ADMIN_TOKEN not configured" })); return
          }
          const url = new URL(req.url, "http://localhost")
          const token = url.searchParams.get("token")
          if (token !== adminToken) {
            res.statusCode = 403; res.end(JSON.stringify({ error: "Invalid token" })); return
          }

          const now = Date.now()
          const tenMinAgo = now - 600000

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
                currentSessions.push({
                  sessionID: sid,
                  clientIP: ip,
                  lastSeen: (() => { const d = new Date(s.lastSeen); const pad = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; })(),
                  status: s.status,
                })
              }
            }
          }

          currentSessions.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))

          const yearlyDaysAgo = new Date(now - 365 * 86400000)
          const dailyTrend = Object.entries(statsData.dailyStats)
            .filter(([key]) => {
              const d = parseDayKey(key)
              return d >= yearlyDaysAgo.getTime()
            })
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => ({ day: key, ...val }))

          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({
            summary: {
              totalClientsEver: statsData.totalClientsEver,
              onlineClients,
              totalSessionsEverCreated: statsData.totalSessionsEverCreated,
              totalMessagesEver: statsData.totalMessagesEver,
              onlineSessions,
              processingSessions,
            },
            currentSessions,
            dailyTrend,
            clientDaySeen: statsData.clientDaySeen,
            sessionDaySeen: statsData.sessionDaySeen,
          }))
          return
        }

        next()
      })
    },
  },
  {
    name: "opencode-desktop:config-runtime-api",
    configureServer(server) {
      const adminToken = process.env.VITE_STATS_ADMIN_TOKEN || ""
      server.middlewares.use(async (req, res, next) => {
        const readBody = async () => {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          return Buffer.concat(chunks).toString()
        }

        if (req.url?.startsWith("/api/config/runtime") && req.method === "GET") {
          try {
            const url = new URL(req.url, "http://localhost")
            const token = url.searchParams.get("token")
            if (token !== adminToken) {
              res.statusCode = 403
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ error: "Invalid token" }))
              return
            }
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({
              announcementText: process.env.VITE_ANNOUNCEMENT_TEXT || "",
              contactAdmin: process.env.VITE_CONTACT_ADMIN || "",
              feedbackUrl: process.env.VITE_FEEDBACK_URL || "",
              helpDocUrl: process.env.VITE_HELP_DOC_URL || "",
              downloadCutoffText: process.env.VITE_DOWNLOAD_CUTOFF_TEXT || "",
            }))
          } catch (error) {
            res.statusCode = 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: error.message }))
          }
          return
        }

        if (req.url?.startsWith("/api/config/runtime") && req.method === "PATCH") {
          try {
            const url = new URL(req.url, "http://localhost")
            const token = url.searchParams.get("token")
            if (token !== adminToken) {
              res.statusCode = 403
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ error: "Invalid token" }))
              return
            }
            const body = JSON.parse(await readBody())
            const envMap = {
              announcementText: "VITE_ANNOUNCEMENT_TEXT",
              contactAdmin: "VITE_CONTACT_ADMIN",
              feedbackUrl: "VITE_FEEDBACK_URL",
              helpDocUrl: "VITE_HELP_DOC_URL",
              downloadCutoffText: "VITE_DOWNLOAD_CUTOFF_TEXT",
            }
            for (const [key, envKey] of Object.entries(envMap)) {
              if (body[key] !== undefined) {
                process.env[envKey] = body[key] || ""
              }
            }
            const envPath = join(dirname(fileURLToPath(import.meta.url)), "../../.env")
            let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : ""
            const envLines = envContent.split("\n")
            const updatedLines = [...envLines]
            for (const [key, envKey] of Object.entries(envMap)) {
              if (body[key] === undefined) continue
              const value = body[key] || ""
              const line = `${envKey}="${value}"`
              const idx = updatedLines.findIndex(l => l.startsWith(`${envKey}=`))
              if (idx >= 0) {
                updatedLines[idx] = line
              } else {
                updatedLines.push(line)
              }
            }
            writeFileSync(envPath, updatedLines.filter(l => l.trim()).join("\n") + "\n", "utf-8")
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ success: true }))
          } catch (error) {
            res.statusCode = 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: error.message }))
          }
          return
        }

        next()
      })
    },
  },
]