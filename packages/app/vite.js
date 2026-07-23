import { readFileSync, writeFileSync, createWriteStream, mkdirSync, existsSync, unlinkSync, statSync, readdirSync, rmdirSync, realpathSync, renameSync, copyFileSync } from "node:fs"
import { dirname, join, extname } from "node:path"
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

            const imageExts = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon" }
            const ext = extname(filePath).toLowerCase()
            if (imageExts[ext]) {
              const buf = readFileSync(fullPath)
              res.end(JSON.stringify({ content: buf.toString("base64"), encoding: "base64", mimeType: imageExts[ext] }))
              return
            }
            const content = readFileSync(fullPath, "utf-8")
            res.end(JSON.stringify({ content }))
          } catch (error) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: error.message }))
          }
        } else if (req.url?.startsWith("/api/case-library/asset") && req.method === "GET") {
          try {
            const caseLibraryDir = process.env.VITE_CASE_LIBRARY_DIR || ""
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
            const mimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon" }
            const ext = extname(filePath).toLowerCase()
            const mimeType = mimeMap[ext] || "application/octet-stream"
            const buf = readFileSync(fullPath)
            res.setHeader("Content-Type", mimeType)
            res.setHeader("Cache-Control", "public, max-age=3600")
            res.end(buf)
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
            console.error(`[${getTzTime()}] upload req error: ${err.message}`)
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
            console.error(`[${getTzTime()}] upload error: ${error.message}`)
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
    async configureServer(server) {
      const { DatabaseSync: Database } = await import("node:sqlite")
      const { createStatsDb } = await import("./stats-db.js")
      const statsDir = process.env.VITE_STATS_DATA_PATH || dirname(fileURLToPath(import.meta.url))
      const statsPath = join(statsDir, "stats.json")
      const dbPath = join(statsDir, "stats.db")
      const adminToken = process.env.VITE_STATS_ADMIN_TOKEN || ""

      const getTzTime = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

      const statsDb = createStatsDb(Database, dbPath, statsPath)

      const getDayKey = (ts) => {
        const d = new Date(ts)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      }

      statsDb.cleanupOldStats(getDayKey(Date.now() - 365 * 86400000))
      const cleanupInterval = setInterval(() => {
        statsDb.cleanupOldStats(getDayKey(Date.now() - 365 * 86400000))
      }, 86400000)

      const gracefulShutdown = () => {
        clearInterval(cleanupInterval)
        statsDb.close()
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
            statsDb.heartbeat(clientIP, sessions, timestamp)
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
            statsDb.sessionCreate(clientIP, sessionID, timestamp)
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
            statsDb.sessionDelete(sessionID)
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
            statsDb.messageSend(timestamp)
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

          const { onlineClients, onlineSessions, processingSessions, currentSessions } = statsDb.getOnlineStats(tenMinAgo)
          const baseDir = process.env.VITE_OPENCODE_DEFAULT_DIR || process.cwd()
          for (const s of currentSessions) {
            s.directory = `${baseDir}/${s.clientIP}`
          }
          const counters = statsDb.getCounters()
          const range = url.searchParams.get("range") || "7d"
          const trend = statsDb.getAggregatedTrend(range)

          currentSessions.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))

          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({
            summary: {
              totalClientsEver: counters.totalClientsEver,
              onlineClients,
              totalSessionsEverCreated: counters.totalSessionsEverCreated,
              totalMessagesEver: counters.totalMessagesEver,
              onlineSessions,
              processingSessions,
            },
            currentSessions,
            trend,
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
              fileTreePollInterval: process.env.VITE_FILE_TREE_POLL_INTERVAL || "5000",
              heartbeatInterval: process.env.VITE_HEARTBEAT_INTERVAL || "60000",
              diskUsageThreshold: process.env.VITE_DISK_USAGE_THRESHOLD || "90",
              caseLibraryDir: process.env.VITE_CASE_LIBRARY_DIR || "",
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
              fileTreePollInterval: "VITE_FILE_TREE_POLL_INTERVAL",
              heartbeatInterval: "VITE_HEARTBEAT_INTERVAL",
              diskUsageThreshold: "VITE_DISK_USAGE_THRESHOLD",
              caseLibraryDir: "VITE_CASE_LIBRARY_DIR",
            }
            for (const [key, envKey] of Object.entries(envMap)) {
              if (body[key] !== undefined) {
                process.env[envKey] = String(body[key])
              }
            }
            const envPath = join(dirname(fileURLToPath(import.meta.url)), "../../.env")
            let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : ""
            const envLines = envContent.split("\n")
            const updatedLines = [...envLines]
            for (const [key, envKey] of Object.entries(envMap)) {
              if (body[key] === undefined) continue
              const value = String(body[key] ?? "")
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