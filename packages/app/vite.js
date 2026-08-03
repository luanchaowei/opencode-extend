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

      async function collectMonitorData(serverPort, env) {
        const CLOCK_HZ = 100
        const mounts = (env.VITE_MONITOR_DISK_MOUNTS || "/").split(",").map(m => m.trim()).filter(Boolean)
        const backendPattern = env.VITE_MONITOR_BACKEND_PATTERN || `opencode serve.*--port ${serverPort}`
        const frontendPattern = env.VITE_MONITOR_FRONTEND_PATTERN || "bun.*packages/app"

        function findPids(pattern) {
          try {
            const out = execSync(`pgrep -f "${pattern}"`, { encoding: "utf8", timeout: 3000 })
            return out.trim().split("\n").map(Number).filter(Boolean)
          } catch { return [] }
        }

        function readProcStat(pid) {
          try {
            const stat = readFileSync(`/proc/${pid}/stat`, "utf8").trim().split(" ")
            const status = readFileSync(`/proc/${pid}/status`, "utf8")
            const io = existsSync(`/proc/${pid}/io`) ? readFileSync(`/proc/${pid}/io`, "utf8") : ""
            const rss = parseInt(status.match(/VmRSS:\s+(\d+)/)?.[1] || "0")
            const memTotalKB = parseInt(readFileSync("/proc/meminfo", "utf8").match(/MemTotal:\s+(\d+)/)?.[1] || "1")
            const memPercent = parseFloat((rss / memTotalKB * 100).toFixed(1))
            const threads = parseInt(status.match(/Threads:\s+(\d+)/)?.[1] || "0")
            const utime = parseInt(stat[13])
            const stime = parseInt(stat[14])
            const starttime = parseInt(stat[21])
            const comm = stat[1].replace(/[()]/g, "")
            const ioMatch = (key) => parseInt(io.match(new RegExp(`${key}:\\s+(\\d+)`))?.[1] || "0")
            const bootTime = parseInt(readFileSync("/proc/stat", "utf8").match(/btime\s+(\d+)/)?.[1] || "0")
            const uptimeSec = Math.floor(Date.now() / 1000) - bootTime - Math.floor(starttime / CLOCK_HZ)
            return { pid, comm, utime, stime, rss, memPercent, threads, uptimeSec, ioRead: ioMatch("read_bytes"), ioWrite: ioMatch("write_bytes") }
          } catch { return null }
        }

        function readSystemStat() {
          try {
            const line = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/)
            const idle = parseInt(line[4])
            const total = line.slice(1).reduce((a, b) => a + parseInt(b), 0)
            return { idle, total }
          } catch { return { idle: 0, total: 0 } }
        }

        function readDiskStats() {
          try {
            const lines = readFileSync("/proc/diskstats", "utf8").trim().split("\n")
            const result = {}
            for (const line of lines) {
              const parts = line.trim().split(/\s+/)
              if (parts.length < 14) continue
              const name = parts[2]
              const readSectors = parseInt(parts[5])
              const writeSectors = parseInt(parts[9])
              const readsCompleted = parseInt(parts[3])
              const writesCompleted = parseInt(parts[7])
              const timeReadingMs = parseInt(parts[6])
              const timeWritingMs = parseInt(parts[10])
              const timeIosMs = parseInt(parts[12])
              result[name] = { readSectors, writeSectors, readsCompleted, writesCompleted, timeReadingMs, timeWritingMs, timeIosMs }
            }
            return result
          } catch { return {} }
        }

        function getDiskUsage(mount) {
          try {
            const out = execSync(`df -h "${mount}"`, { encoding: "utf8", timeout: 3000 })
            const lines = out.trim().split("\n")
            if (lines.length < 2) return null
            const parts = lines[1].trim().split(/\s+/)
            if (parts.length < 6) return null
            return { filesystem: parts[0], size: parts[1], used: parts[2], avail: parts[3], usePercent: parseInt(parts[4]), mount: parts[5] }
          } catch { return null }
        }

        function getDiskDevice(filesystem) {
          if (!filesystem || filesystem === "none" || filesystem.startsWith("tmpfs") || filesystem.startsWith("devtmpfs")) return null
          let devPath = filesystem
          try {
            const resolved = realpathSync(devPath)
            if (resolved) devPath = resolved
          } catch {}
          const dev = devPath.replace("/dev/", "")
          for (const name of [dev, dev.replace(/p?\d+$/, "")]) {
            if (name && existsSync(`/sys/block/${name}`)) return name
          }
          return dev || null
        }

        function formatUptime(sec) {
          const d = Math.floor(sec / 86400)
          const h = Math.floor((sec % 86400) / 3600)
          const m = Math.floor((sec % 3600) / 60)
          if (d > 0) return `${d}天${h}小时`
          if (h > 0) return `${h}小时${m}分钟`
          return `${m}分钟`
        }

        function getCmdline(pid) {
          try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim() } catch { return "" }
        }

        const backendPids = findPids(backendPattern)
        const frontendPids = findPids(frontendPattern)

        const t1 = {
          backend: backendPids.map(p => readProcStat(p)).filter(Boolean),
          frontend: frontendPids.map(p => readProcStat(p)).filter(Boolean),
          system: readSystemStat(),
          disks: readDiskStats(),
        }

        await new Promise(r => setTimeout(r, 1000))

        const t2 = {
          backend: backendPids.map(p => readProcStat(p)).filter(Boolean),
          frontend: frontendPids.map(p => readProcStat(p)).filter(Boolean),
          system: readSystemStat(),
          disks: readDiskStats(),
        }

        function buildProcess(t1p, t2p) {
          if (!t1p || !t2p || t1p.length === 0) return null
          const p1 = t1p[0], p2 = t2p[0]
          const cpu = ((p2.utime + p2.stime - p1.utime - p1.stime) / CLOCK_HZ) * 100
          const ioReadKBps = Math.max(0, (p2.ioRead - p1.ioRead) / 1024)
          const ioWriteKBps = Math.max(0, (p2.ioWrite - p1.ioWrite) / 1024)
          return {
            pid: p2.pid,
            name: p2.comm,
            cmd: getCmdline(p2.pid),
            cpu: cpu.toFixed(1),
            memRSS: p2.rss,
            memPercent: p2.memPercent,
            threads: p2.threads,
            uptime: formatUptime(p2.uptimeSec),
            ioReadKBps: ioReadKBps.toFixed(1),
            ioWriteKBps: ioWriteKBps.toFixed(1),
          }
        }

        const sysCpu = t2.system.total - t1.system.total > 0
          ? ((1 - (t2.system.idle - t1.system.idle) / (t2.system.total - t1.system.total)) * 100).toFixed(1)
          : "0"

        const meminfo = readFileSync("/proc/meminfo", "utf8")
        const memTotalKB = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || "0")
        const memAvailableKB = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || "0")
        const memUsedKB = memTotalKB - memAvailableKB

        const loadavg = readFileSync("/proc/loadavg", "utf8").trim().split(" ").slice(0, 3).map(Number)

        const disks = mounts.map(m => getDiskUsage(m)).filter(Boolean)
        const diskIO = disks.map(d => {
          const dev = getDiskDevice(d.filesystem)
          if (!dev) return { device: d.filesystem, readKBps: "-", writeKBps: "-", readAwaitMs: "-", writeAwaitMs: "-", readUtilPercent: "-", writeUtilPercent: "-" }
          const s1 = t1.disks[dev]
          const s2 = t2.disks[dev]
          if (!s1 || !s2) return { device: dev, readKBps: "-", writeKBps: "-", readAwaitMs: "-", writeAwaitMs: "-", readUtilPercent: "-", writeUtilPercent: "-" }
          const readKBps = Math.max(0, (s2.readSectors - s1.readSectors) * 512 / 1024)
          const writeKBps = Math.max(0, (s2.writeSectors - s1.writeSectors) * 512 / 1024)
          const readsDiff = s2.readsCompleted - s1.readsCompleted
          const writesDiff = s2.writesCompleted - s1.writesCompleted
          const readAwaitMs = readsDiff > 0 ? ((s2.timeReadingMs - s1.timeReadingMs) / readsDiff).toFixed(1) : "0.0"
          const writeAwaitMs = writesDiff > 0 ? ((s2.timeWritingMs - s1.timeWritingMs) / writesDiff).toFixed(1) : "0.0"
          const readUtilPercent = Math.min(100, (s2.timeReadingMs - s1.timeReadingMs) / 10).toFixed(1)
          const writeUtilPercent = Math.min(100, (s2.timeWritingMs - s1.timeWritingMs) / 10).toFixed(1)
          return { device: dev, readKBps: readKBps.toFixed(1), writeKBps: writeKBps.toFixed(1), readAwaitMs, writeAwaitMs, readUtilPercent, writeUtilPercent }
        })

        return {
          processes: {
            backend: buildProcess(t1.backend, t2.backend),
            frontend: buildProcess(t1.frontend, t2.frontend),
          },
          disks,
          diskIO,
          system: {
            cpuPercent: parseFloat(sysCpu),
            memTotal: Math.floor(memTotalKB / 1024),
            memUsed: Math.floor(memUsedKB / 1024),
            memPercent: memTotalKB > 0 ? parseFloat((memUsedKB / memTotalKB * 100).toFixed(1)) : 0,
            loadAvg: loadavg,
          },
        }
      }

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
          const granularity = url.searchParams.get("granularity") || "day"
          const startDate = url.searchParams.get("start") || ""
          const endDate = url.searchParams.get("end") || ""
          const trend = statsDb.getAggregatedTrend(range, granularity, startDate, endDate)

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

        if (req.url?.startsWith("/api/system/monitor") && req.method === "GET") {
          try {
            const urlObj = new URL(req.url, `http://${req.headers.host}`)
            const token = urlObj.searchParams.get("token")
            if (!adminToken || token !== adminToken) {
              res.statusCode = 403
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ error: "Invalid token" }))
              return
            }
            const serverPort = process.env.VITE_OPENCODE_SERVER_PORT || "4096"
            const result = await collectMonitorData(serverPort, process.env)
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify(result))
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
              monitorDiskMounts: process.env.VITE_MONITOR_DISK_MOUNTS || "/",
              monitorBackendPattern: process.env.VITE_MONITOR_BACKEND_PATTERN || "",
              monitorFrontendPattern: process.env.VITE_MONITOR_FRONTEND_PATTERN || "",
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
              monitorDiskMounts: "VITE_MONITOR_DISK_MOUNTS",
              monitorBackendPattern: "VITE_MONITOR_BACKEND_PATTERN",
              monitorFrontendPattern: "VITE_MONITOR_FRONTEND_PATTERN",
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