import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync, readdirSync, rmdirSync, realpathSync, renameSync, copyFileSync } from "node:fs"
import { dirname, join, extname } from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "url"
import { createStatsDb } from "./stats-db.js"
import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"

const isCompiled = import.meta.dir.startsWith("/$bunfs")
const __dirname = isCompiled ? dirname(process.execPath) : dirname(fileURLToPath(import.meta.url))
const projectRoot = isCompiled ? __dirname : dirname(dirname(__dirname))

const cliArgs = {}
const validArgs = new Set(["host", "port", "log", "server-host", "server-port", "server-password", "server-username", "workspace", "stats-path", "auth-enabled", "admin-username", "admin-password", "help", "h"])

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]
  if (arg === "--help" || arg === "-h") {
    console.log(`用法: opencode-extend [选项]

选项:
  --host <addr>              前端监听地址 (默认: 0.0.0.0)
  --port <port>              前端端口 (默认: 3000)
  --log <path>               日志文件路径 (默认: /tmp/opencode-extend.log)
  --server-host <addr>       opencode 后端地址 (默认: 127.0.0.1)
  --server-port <port>       opencode 后端端口 (默认: 4096)
  --server-password <pwd>    后端认证密码，为空不认证
  --server-username <name>   后端认证用户名 (默认: opencode)
  --workspace <path>         用户工作目录，每个IP自动创建子目录
  --stats-path <path>        stats.db 存储路径 (默认: 可执行文件所在目录)
  --auth-enabled             启用登录认证
  --admin-username <name>    超级管理员用户名 (默认: admin)
  --admin-password <pwd>     超级管理员密码 (默认: admin123)

以上选项优先级高于 .env 文件中的同名配置。
可通过系统设置页面配置的项（公告、支撑人员、知识库等）不需要在此指定。

示例:
  ./opencode-extend --host 127.0.0.1 --port 3000 --server-host 127.0.0.1 --server-port 4096 --workspace /home/user/client --auth-enabled --admin-username admin --admin-password MyPass123!
`)
    process.exit(0)
  }
  if (!arg.startsWith("--")) {
    console.error(`错误: 无效参数 '${arg}'\n运行 '--help' 查看可用选项。`)
    process.exit(1)
  }
  const argName = arg.replace(/^--/, "")
  if (!validArgs.has(argName)) {
    console.error(`错误: 未知选项 '${arg}'\n运行 '--help' 查看可用选项。`)
    process.exit(1)
  }
  const key = argName.replace(/-/g, "_")
  const next = process.argv[i + 1]
  if (key === "auth_enabled") {
    cliArgs[key] = "true"
  } else if (next && !next.startsWith("--")) {
    cliArgs[key] = next
    i++
  } else {
    console.error(`错误: 选项 '${arg}' 需要一个值\n运行 '--help' 查看用法。`)
    process.exit(1)
  }
}

const cliMap = {
  host: "WEB_HOST",
  port: "WEB_PORT",
  log: "LOG_PATH",
  server_host: "VITE_OPENCODE_SERVER_HOST",
  server_port: "VITE_OPENCODE_SERVER_PORT",
  server_password: "VITE_OPENCODE_SERVER_PASSWORD",
  server_username: "VITE_OPENCODE_SERVER_USERNAME",
  workspace: "VITE_OPENCODE_DEFAULT_DIR",
  stats_path: "VITE_STATS_DATA_PATH",
  auth_enabled: "AUTH_ENABLED",
  admin_username: "ADMIN_USERNAME",
  admin_password: "ADMIN_PASSWORD",
}

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

for (const [cliKey, envKey] of Object.entries(cliMap)) {
  if (cliArgs[cliKey] !== undefined) {
    envVars[envKey] = cliArgs[cliKey]
    process.env[envKey] = cliArgs[cliKey]
  }
}

const serverHost = envVars.VITE_OPENCODE_SERVER_HOST || "127.0.0.1"
const serverPort = parseInt(envVars.VITE_OPENCODE_SERVER_PORT || "4096")
const serverUrl = `http://${serverHost}:${serverPort}`
const serverPassword = envVars.VITE_OPENCODE_SERVER_PASSWORD || ""
const serverUsername = envVars.VITE_OPENCODE_SERVER_USERNAME || "opencode"
const serverAuthHeader = serverPassword ? `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")}` : ""
const buildTime = Date.now()
process.env.NO_PROXY = "*"
console.log(`[${getTzTime()}] NO_PROXY=* (skip proxy for all fetch requests)`)
const webHost = envVars.WEB_HOST || "0.0.0.0"
const webPort = parseInt(envVars.WEB_PORT || "3000")
let embeddedFiles = null
if (isCompiled) {
  try {
    const manifest = await import("./embedded-manifest.js")
    embeddedFiles = manifest.embeddedFiles
    console.log(`[${getTzTime()}] Loaded ${Object.keys(embeddedFiles).length} embedded files`)
  } catch (e) {
    console.error(`[${getTzTime()}] Failed to load embedded manifest: ${e.message}`)
  }
}

const distDir = isCompiled ? null : join(__dirname, "dist")

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
  const ext = getExt(urlPath)
  const mime = mimeTypes[ext] || 'application/octet-stream'
  if (isCompiled && embeddedFiles) {
    const file = embeddedFiles[urlPath]
    if (file) {
      return { content: Buffer.from(file.content, "base64"), mime }
    }
    return null
  }
  if (isCompiled) return null
  const filePath = join(distDir, urlPath)
  if (!filePath.startsWith(distDir)) return null
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return { content: readFileSync(filePath), mime }
  }
  return null
}

const statsDir = envVars.VITE_STATS_DATA_PATH || __dirname
const statsPath = join(statsDir, "stats.json")
const dbPath = join(statsDir, "stats.db")

const statsDb = createStatsDb(Database, dbPath, statsPath)

const authEnabled = envVars.AUTH_ENABLED === "true"

const adminUsername = envVars.ADMIN_USERNAME || "admin"
const adminPassword = envVars.ADMIN_PASSWORD || "admin123!"
statsDb.ensureSuperAdmin(adminUsername, adminPassword)

const sessions = new Map()
const SESSION_DURATION = 30 * 60 * 1000

function createSession(userId, username, role) {
  const id = randomUUID()
  sessions.set(id, { userId, username, role, expireAt: Date.now() + SESSION_DURATION })
  return id
}

function getSession(req, renew = true) {
  const cookie = req.headers.get("cookie") || ""
  const match = cookie.match(/session_id=([^;]+)/)
  if (!match) return null
  const session = sessions.get(match[1])
  if (!session) return null
  if (Date.now() > session.expireAt) {
    sessions.delete(match[1])
    return null
  }
  if (renew) session.expireAt = Date.now() + SESSION_DURATION
  return session
}

function sessionCookie(sessionId) {
  return `session_id=${sessionId}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION / 1000}; SameSite=Lax`
}

function clearSessionCookie() {
  return `session_id=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
}

function requireAdmin(req) {
  if (!authEnabled) return true
  const session = getSession(req)
  return session !== null && (session.role === "admin" || session.role === "super_admin")
}

function requireSuperAdmin(req) {
  if (!authEnabled) return true
  const session = getSession(req)
  return session !== null && session.role === "super_admin"
}

function redirectToLogin() {
  return new Response(null, { status: 302, headers: { "Location": "/login" } })
}

const loginPageHtml = `<!DOCTYPE html>
<html lang="zh-CN" style="color-scheme: light">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登录 - GE诊断助手</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--background-base, #f8f8f8); color: var(--text-strong, #171717); font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .login-box { background: var(--background-stronger, #fcfcfc); border: 1px solid var(--border-weak-base, #e5e5e5); border-radius: 12px; padding: 32px; width: 100%; max-width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .login-box h1 { font-size: 18px; font-weight: 600; margin-bottom: 24px; text-align: center; }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 12px; color: #888; margin-bottom: 6px; }
  .field input { width: 100%; background: var(--background-base, #f8f8f8); border: 1px solid var(--border-weak-base, #e5e5e5); border-radius: 8px; padding: 10px 14px; font-size: 14px; color: var(--text-strong, #171717); outline: none; transition: border-color 0.15s; }
  .field input:focus { border-color: #2563eb; }
  .login-btn { width: 100%; padding: 10px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; margin-top: 8px; transition: background 0.15s; }
  .login-btn:hover { background: #1d4ed8; }
  .login-btn:disabled { background: #93c5fd; cursor: not-allowed; }
  .error-msg { color: #ef4444; font-size: 12px; margin-top: 12px; text-align: center; display: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #101010; color: rgba(255,255,255,0.936); }
    .login-box { background: #151515; border-color: #282828; }
    .field input { background: #101010; border-color: #282828; color: rgba(255,255,255,0.936); }
  }
</style>
</head>
<body>
<div class="login-box">
  <h1>GE诊断助手</h1>
  <form id="login-form">
    <div class="field"><label>用户名</label><input type="text" id="username" autocomplete="username" autofocus></div>
    <div class="field"><label>密码</label><input type="password" id="password" autocomplete="current-password"></div>
    <button type="submit" class="login-btn" id="login-btn">登录</button>
    <div class="error-msg" id="error-msg"></div>
  </form>
</div>
<script>
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = document.getElementById('login-btn')
  const errEl = document.getElementById('error-msg')
  const username = document.getElementById('username').value
  const password = document.getElementById('password').value
  if (!username || !password) { errEl.textContent = '请输入用户名和密码'; errEl.style.display = 'block'; return }
  btn.disabled = true; btn.textContent = '登录中...'
  errEl.style.display = 'none'
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
    if (res.ok) { window.location.href = '/' }
    else { const data = await res.json(); errEl.textContent = data.error || '登录失败'; errEl.style.display = 'block' }
  } catch { errEl.textContent = '网络错误'; errEl.style.display = 'block' }
  btn.disabled = false; btn.textContent = '登录'
})
</script>
</body>
</html>`

const sessionNotFoundHtml = (backHref) => `<!DOCTYPE html>
<html lang="zh-CN" style="color-scheme: light dark">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>会话不存在</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--background-base, #f8f8f8); color: var(--text-strong, #171717); font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .box { text-align: center; padding: 32px; max-width: 400px; }
  .box h1 { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
  .box p { font-size: 14px; color: var(--text-weak, #888); margin-bottom: 24px; line-height: 1.6; }
  .btn { display: inline-block; padding: 10px 24px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; }
  .btn:hover { background: #1d4ed8; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: rgba(255,255,255,0.936); }
    .box p { color: #888; }
  }
</style>
</head>
<body>
  <div class="box">
    <h1>会话不存在</h1>
    <p>该会话可能已被删除或清理，请返回创建新的会话。</p>
    <a href="${backHref}" class="btn">返回会话列表</a>
  </div>
</body>
</html>`

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

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extraHeaders } })
}

async function readBody(req) {
  const buffer = await req.arrayBuffer()
  return Buffer.from(buffer).toString()
}

async function handleAPI(req, server) {
  const url = new URL(req.url, "http://localhost")
  const method = req.method

  if (url.pathname === "/api/login" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { username, password } = body
      if (!username || !password) return jsonResponse({ error: "请输入用户名和密码" }, 400)
      const user = statsDb.verifyUser(username, password)
      if (!user) return jsonResponse({ error: "用户名或密码错误" }, 401)
      const sessionId = createSession(user.id, user.username, user.role)
      return jsonResponse({ ok: true, username: user.username, role: user.role }, 200, { "Set-Cookie": sessionCookie(sessionId) })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname === "/api/logout" && method === "POST") {
    const cookie = req.headers.get("cookie") || ""
    const match = cookie.match(/session_id=([^;]+)/)
    if (match) sessions.delete(match[1])
    return jsonResponse({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() })
  }

  if (url.pathname === "/api/auth/me" && method === "GET") {
    if (!authEnabled) return jsonResponse({ username: "", role: "" })
    const session = getSession(req)
    if (!session) return jsonResponse({ error: "Not authenticated" }, 401)
    return jsonResponse({ username: session.username, role: session.role, userId: session.userId })
  }

  if (url.pathname === "/api/users" && method === "GET") {
    if (!requireSuperAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)
    return jsonResponse({ users: statsDb.listUsers() })
  }

  if (url.pathname === "/api/users" && method === "POST") {
    if (!requireSuperAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)
    try {
      const body = JSON.parse(await readBody(req))
      const { username, password, role } = body
      const result = statsDb.createUser(username, password, role)
      if (result.error) return jsonResponse({ error: result.error }, 400)
      return jsonResponse({ ok: true, user: result })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname.startsWith("/api/users/") && method === "DELETE") {
    if (!requireSuperAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)
    const id = parseInt(url.pathname.split("/").pop())
    if (isNaN(id)) return jsonResponse({ error: "Invalid user ID" }, 400)
    const session = getSession(req)
    if (session && session.userId === id) return jsonResponse({ error: "Cannot delete yourself" }, 400)
    const result = statsDb.deleteUser(id)
    if (result.error) return jsonResponse({ error: result.error }, 400)
    return jsonResponse({ ok: true })
  }

  if (url.pathname.startsWith("/api/users/") && method === "PATCH") {
    if (!requireSuperAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)
    const id = parseInt(url.pathname.split("/").pop())
    if (isNaN(id)) return jsonResponse({ error: "Invalid user ID" }, 400)
    try {
      const body = JSON.parse(await readBody(req))
      if (body.password !== undefined) {
        const result = statsDb.updateUserPassword(id, body.password)
        if (result.error) return jsonResponse({ error: result.error }, 400)
      }
      if (body.role !== undefined) {
        const result = statsDb.updateUserRole(id, body.role)
        if (result.error) return jsonResponse({ error: result.error }, 400)
      }
      return jsonResponse({ ok: true })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname === "/device/info" && method === "GET") {
    const contactAdmin = process.env.VITE_CONTACT_ADMIN || ""
    const contactList = contactAdmin.split('|').filter(line => line.trim())
    const hiddenProviders = (process.env.VITE_HIDDEN_PROVIDERS || "").split(",").map(s => s.trim()).filter(Boolean)
    return jsonResponse({
      clientIP: getClientIP(req, server),
      contactAdmin: contactList,
      feedbackUrl: process.env.VITE_FEEDBACK_URL || "",
      caseLibraryDir: process.env.VITE_CASE_LIBRARY_DIR || "",
      helpDocUrl: process.env.VITE_HELP_DOC_URL || "",
      announcementText: process.env.VITE_ANNOUNCEMENT_TEXT || "",
      downloadCutoffText: process.env.VITE_DOWNLOAD_CUTOFF_TEXT || "",
      fileTreePollInterval: parseInt(process.env.VITE_FILE_TREE_POLL_INTERVAL || "5000", 10),
      heartbeatInterval: parseInt(process.env.VITE_HEARTBEAT_INTERVAL || "60000", 10),
      diskUsageThreshold: parseInt(process.env.VITE_DISK_USAGE_THRESHOLD || "90", 10),
      defaultDir: process.env.VITE_OPENCODE_DEFAULT_DIR || "",
      serverHost: process.env.VITE_OPENCODE_SERVER_HOST || "",
      serverPort: process.env.VITE_OPENCODE_SERVER_PORT || "",
      serverUsername: process.env.VITE_OPENCODE_SERVER_USERNAME || "",
      serverPassword: process.env.VITE_OPENCODE_SERVER_PASSWORD || "",
      hiddenProviders,
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
      const imageExts = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon" }
      const ext = extname(filePath).toLowerCase()
      if (imageExts[ext]) {
        const buf = readFileSync(fullPath)
        return jsonResponse({ content: buf.toString("base64"), encoding: "base64", mimeType: imageExts[ext] })
      }
      const content = readFileSync(fullPath, "utf-8")
      return jsonResponse({ content })
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  if (url.pathname.startsWith("/api/case-library/asset") && method === "GET") {
    try {
      const caseLibraryDir = process.env.VITE_CASE_LIBRARY_DIR || ""
      if (!caseLibraryDir) return jsonResponse({ error: "Case library not configured" }, 400)
      const filePath = url.searchParams.get("path")
      if (!filePath) return jsonResponse({ error: "Missing path" }, 400)
      const fullPath = join(caseLibraryDir, filePath)
      if (!existsSync(fullPath)) return jsonResponse({ error: "File not found" }, 404)
      const mimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon" }
      const ext = extname(filePath).toLowerCase()
      const mimeType = mimeMap[ext] || "application/octet-stream"
      const buf = readFileSync(fullPath)
      return new Response(buf, { headers: { "Content-Type": mimeType, "Cache-Control": "public, max-age=3600" } })
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }
  }

  if (url.pathname.startsWith("/file/upload") && method === "POST") {
    let tmpPath = null
    let writer = null
    try {
      const directory = url.searchParams.get("directory")
      if (directory) {
        try {
          const dfOutput = execSync(`df "${directory}" --output=pcent`, { encoding: "utf8" }).trim()
          const lines = dfOutput.split("\n")
          const usePercent = parseInt(lines[1]?.trim().replace("%", ""), 10)
          const diskThreshold = parseInt(process.env.VITE_DISK_USAGE_THRESHOLD || "90", 10)
          if (usePercent >= diskThreshold) {
            return jsonResponse({ error: `磁盘使用率 ${usePercent}%，超过${diskThreshold}%阈值，无法上传文件，请联系管理员！` }, 507)
          }
        } catch {}
      }
      if (!directory) return jsonResponse({ error: "Missing directory" }, 400)

      const boundary = req.headers.get("content-type")?.split("boundary=")[1]
      if (!boundary) return jsonResponse({ error: "Missing boundary" }, 400)

      const boundaryBuf = Buffer.from(`\r\n--${boundary}`)
      const endBoundaryBuf = Buffer.from(`--${boundary}--`)
      const firstBoundaryBuf = Buffer.from(`--${boundary}\r\n`)
      const reader = req.body.getReader()

      let state = "search_first"
      let leftover = Buffer.alloc(0)
      let filePath = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        let data = Buffer.concat([leftover, value])
        leftover = Buffer.alloc(0)

        if (state === "search_first") {
          const idx = data.indexOf(firstBoundaryBuf)
          if (idx !== -1) {
            data = data.slice(idx + firstBoundaryBuf.length)
            state = "read_header"
          } else {
            leftover = data
          }
        }

        if (state === "read_header") {
          const headerEnd = data.indexOf(Buffer.from('\r\n\r\n'))
          if (headerEnd !== -1) {
            const header = data.slice(0, headerEnd).toString()
            data = data.slice(headerEnd + 4)
            if (header.includes('name="file"')) {
              tmpPath = join(directory, `.upload_tmp_${Date.now()}`)
              writer = Bun.file(tmpPath).writer()
              state = "write_file"
            } else if (header.includes('name="path"')) {
              state = "read_path"
            } else {
              state = "skip_part"
            }
          } else {
            leftover = data
          }
        }

        if (state === "write_file") {
          const boundaryIdx = data.indexOf(boundaryBuf)
          if (boundaryIdx !== -1) {
            writer.write(data.slice(0, boundaryIdx))
            writer.end()
            data = data.slice(boundaryIdx + boundaryBuf.length + 2)
            state = "read_header"
            const headerEnd = data.indexOf(Buffer.from('\r\n\r\n'))
            if (headerEnd !== -1) {
              const header = data.slice(0, headerEnd).toString()
              console.log(`[${getTzTime()}] header parsed: ${header.replace(/\r\n/g, '|')}`)
              data = data.slice(headerEnd + 4)
              if (header.includes('name="file"')) {
                tmpPath = join(directory, `.upload_tmp_${Date.now()}`)
                writer = Bun.file(tmpPath).writer()
                state = "write_file"
              } else if (header.includes('name="path"')) {
                state = "read_path"
              } else {
                state = "skip_part"
              }
            } else {
              leftover = data
            }
          } else {
            const safeLen = data.length - boundaryBuf.length
            if (safeLen > 0) {
              writer.write(data.slice(0, safeLen))
              leftover = data.slice(safeLen)
            } else {
              leftover = data
            }
          }
        }

        if (state === "read_path") {
          const boundaryIdx = data.indexOf(boundaryBuf)
          if (boundaryIdx !== -1) {
            filePath = data.slice(0, boundaryIdx).toString().trim()
            data = data.slice(boundaryIdx + boundaryBuf.length)
            state = "read_header"
          } else {
            leftover = data
          }
        }

        if (state === "skip_part") {
          const boundaryIdx = data.indexOf(boundaryBuf)
          if (boundaryIdx !== -1) {
            data = data.slice(boundaryIdx + boundaryBuf.length + 2)
            state = "read_header"
            const headerEnd = data.indexOf(Buffer.from('\r\n\r\n'))
            if (headerEnd !== -1) {
              const header = data.slice(0, headerEnd).toString()
              console.log(`[${getTzTime()}] upload header parsed: ${header.replace(/\r\n/g, '|')}`)
              data = data.slice(headerEnd + 4)
              if (header.includes('name="file"')) {
                tmpPath = join(directory, `.upload_tmp_${Date.now()}`)
                writer = Bun.file(tmpPath).writer()
                state = "write_file"
              } else if (header.includes('name="path"')) {
                state = "read_path"
              } else {
                state = "skip_part"
              }
            } else {
              leftover = data
            }
          } else {
            leftover = data
          }
        }

        if (state === "read_header" && data.includes(endBoundaryBuf)) {
          break
        }
      }

      if (!tmpPath || !filePath) return jsonResponse({ error: "Missing file or path" }, 400)

      const fullPath = filePath.startsWith("/") ? filePath : join(directory, filePath)
      const dir = dirname(fullPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      renameSync(tmpPath, fullPath)
      tmpPath = null

      return jsonResponse({ success: true, path: fullPath })
    } catch (error) {
      console.error(`[${getTzTime()}] error: ${error.message}`)
      if (tmpPath) { try { unlinkSync(tmpPath) } catch {} }
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
      const file = Bun.file(fullPath)
      const filename = filePath.split("/").pop() || "download"
      return new Response(file, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Content-Length": file.size,
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
      const { clientIP, sessions, timestamp } = body
      if (!clientIP) return jsonResponse({ error: "Missing clientIP" }, 400)
      statsDb.heartbeat(clientIP, sessions, timestamp)
      return jsonResponse({ ok: true, buildTime })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname === "/api/stats/session-create" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req))
      const { clientIP, sessionID, timestamp } = body
      if (!clientIP || !sessionID) return jsonResponse({ error: "Missing clientIP or sessionID" }, 400)
      const result = statsDb.sessionCreate(clientIP, sessionID, timestamp)
      if (result.isNew) {
        console.log(`[${getTzTime()}] session-create NEW: ip=${clientIP} sid=${sessionID} total=${result.total}`)
      } else {
        console.log(`[${getTzTime()}] session-create DEDUP: ip=${clientIP} sid=${sessionID}`)
      }
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
      statsDb.sessionDelete(sessionID)
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
      statsDb.messageSend(timestamp)
      return jsonResponse({ ok: true })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname.startsWith("/api/stats") && method === "GET") {
    if (!requireAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)

    const now = Date.now()
    const tenMinAgo = now - 600000

    try {
      const busyIPs = statsDb.getBusySessionDirs(tenMinAgo)
      const baseDir = envVars.VITE_OPENCODE_DEFAULT_DIR || process.cwd()
      const directories = new Set(busyIPs.map(ip => `${baseDir}/${ip}`))
      const allRealStatuses = {}
      for (const dir of directories) {
        try {
          const res = await fetch(`${serverUrl}/session/status?directory=${encodeURIComponent(dir)}`, {
            signal: AbortSignal.timeout(5000),
            headers: serverAuthHeader ? { Authorization: serverAuthHeader } : {},
          })
          if (res.ok) {
            const map = await res.json()
            console.log(`[${getTzTime()}] align dir=${dir} backendStatus=${JSON.stringify(map)}`)
            Object.assign(allRealStatuses, map)
          } else {
            console.log(`[${getTzTime()}] align dir=${dir} backend returned ${res.status}`)
          }
        } catch (err) {
          console.error(`[${getTzTime()}] align dir=${dir} fetch failed: ${err.message}`)
        }
      }
      const busySessions = statsDb.getBusySessions(tenMinAgo)
      for (const { ip, sid, status } of busySessions) {
        const real = allRealStatuses[sid]
        const oldStatus = status
        const newStatus = real ? real.type : "idle"
        if (oldStatus !== newStatus) {
          statsDb.updateSessionStatus(ip, sid, newStatus)
          console.log(`[${getTzTime()}] align sid=${sid} ip=${ip} oldStatus=${oldStatus} realStatus=${real ? JSON.stringify(real) : "null"} newStatus=${newStatus}`)
        }
      }
    } catch (err) {
      console.error(`[${getTzTime()}] failed to align session status: ${err.message}`)
    }

    const { onlineClients, onlineSessions, processingSessions, currentSessions } = statsDb.getOnlineStats(tenMinAgo)
    const baseDir = envVars.VITE_OPENCODE_DEFAULT_DIR || process.cwd()
    for (const s of currentSessions) {
      s.directory = `${baseDir}/${s.clientIP}`
    }
    const counters = statsDb.getCounters()
    const range = url.searchParams.get("range") || "7d"
    const granularity = url.searchParams.get("granularity") || "day"
    const startDate = url.searchParams.get("start") || ""
    const endDate = url.searchParams.get("end") || ""
    const trend = statsDb.getAggregatedTrend(range, granularity, startDate, endDate)

    return jsonResponse({
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
    })
  }

  if (url.pathname === "/api/models/list" && method === "GET") {
    if (!requireAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)
    try {
      const res = await fetch(`${serverUrl}/config/providers`, {
        headers: serverAuthHeader ? { Authorization: serverAuthHeader } : {},
      })
      if (!res.ok) return jsonResponse({ error: `Backend returned ${res.status}` }, res.status)
      const data = await res.json()
      const hiddenSet = new Set((process.env.VITE_HIDDEN_PROVIDERS || "").split(",").map(s => s.trim()).filter(Boolean))
      const providers = (data.providers || []).filter(p => !hiddenSet.has(p.id))
      const testResults = new Map()
      for (const r of statsDb.getModelTestResults()) {
        testResults.set(`${r.provider_id}:${r.model_id}`, r)
      }
      const models = []
      for (const p of providers) {
        const pModels = p.models || {}
        for (const [modelID, model] of Object.entries(pModels)) {
          if (model.status === "deprecated") continue
          const testResult = testResults.get(`${p.id}:${modelID}`)
          models.push({
            providerID: p.id,
            providerName: p.name || p.id,
            modelID,
            modelName: model.name || modelID,
            status: model.status || "active",
            testResult: testResult ? {
              success: !!testResult.success,
              error: testResult.error || "",
              durationMs: testResult.duration_ms,
              testedAt: testResult.tested_at,
            } : null,
          })
        }
      }
      return jsonResponse({ models })
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname === "/api/models/test" && method === "POST") {
    if (!requireAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)
    let sessionID = null
    const testStart = Date.now()
    try {
      const body = JSON.parse(await readBody(req))
      const { providerID, modelID } = body
      if (!providerID || !modelID) return jsonResponse({ error: "Missing providerID or modelID" }, 400)

      const defaultDir = envVars.VITE_OPENCODE_DEFAULT_DIR || ""
      if (!defaultDir) return jsonResponse({ error: "VITE_OPENCODE_DEFAULT_DIR not configured" }, 500)

      const sessionRes = await fetch(`${serverUrl}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(serverAuthHeader ? { Authorization: serverAuthHeader } : {}) },
        body: JSON.stringify({ directory: defaultDir, title: "model-test" }),
      })
      if (!sessionRes.ok) {
        const errText = await sessionRes.text()
        const durationMs = Date.now() - testStart
        const errorMsg = `创建会话失败: ${sessionRes.status} ${errText}`
        statsDb.saveModelTestResult(providerID, modelID, false, errorMsg, durationMs)
        return jsonResponse({ success: false, error: errorMsg, durationMs })
      }
      const sessionData = await sessionRes.json()
      sessionID = sessionData.id
      if (!sessionID) {
        const durationMs = Date.now() - testStart
        const errorMsg = "创建会话失败: 未返回 sessionID"
        statsDb.saveModelTestResult(providerID, modelID, false, errorMsg, durationMs)
        return jsonResponse({ success: false, error: errorMsg, durationMs })
      }

      const msgRes = await fetch(`${serverUrl}/session/${sessionID}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(serverAuthHeader ? { Authorization: serverAuthHeader } : {}) },
        body: JSON.stringify({
          model: { providerID, modelID },
          parts: [{ type: "text", text: "hi" }],
        }),
      })

      const durationMs = Date.now() - testStart

      if (msgRes.ok) {
        statsDb.saveModelTestResult(providerID, modelID, true, "", durationMs)
        return jsonResponse({ success: true, durationMs })
      } else {
        const errText = await msgRes.text()
        let errMsg = errText
        try { errMsg = JSON.parse(errText).error || errMsg } catch {}
        statsDb.saveModelTestResult(providerID, modelID, false, errMsg, durationMs)
        return jsonResponse({ success: false, error: errMsg, durationMs })
      }
    } catch (err) {
      const durationMs = Date.now() - testStart
      statsDb.saveModelTestResult(providerID || "", modelID || "", false, err.message, durationMs)
      return jsonResponse({ success: false, error: err.message, durationMs })
    } finally {
      if (sessionID) {
        try {
          await fetch(`${serverUrl}/session/${sessionID}?directory=${encodeURIComponent(envVars.VITE_OPENCODE_DEFAULT_DIR || "")}`, {
            method: "DELETE",
            headers: serverAuthHeader ? { Authorization: serverAuthHeader } : {},
          })
        } catch {}
      }
    }
  }

  if (url.pathname.startsWith("/api/system/monitor") && method === "GET") {
    if (!requireAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)

    try {
      const serverPort = envVars.VITE_OPENCODE_SERVER_PORT || "4096"
      const result = await collectMonitorData(serverPort, process.env)
      return jsonResponse(result)
    } catch (err) {
      return jsonResponse({ error: err.message }, 500)
    }
  }

  if (url.pathname.startsWith("/api/config/runtime") && method === "GET") {
    if (!requireAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)
    return jsonResponse({
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
      hiddenProviders: process.env.VITE_HIDDEN_PROVIDERS || "",
    })
  }

  if (url.pathname.startsWith("/api/config/runtime") && method === "PATCH") {
    if (!requireAdmin(req)) return jsonResponse({ error: "Forbidden" }, 403)
    try {
      const body = JSON.parse(await readBody(req))
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
        hiddenProviders: "VITE_HIDDEN_PROVIDERS",
      }
      for (const [key, envKey] of Object.entries(envMap)) {
        if (body[key] !== undefined) process.env[envKey] = String(body[key])
      }
      let envContent = existsSync(envPath) ? readFileSync(envPath, "utf-8") : ""
      const envLines = envContent.split("\n")
      const updatedLines = [...envLines]
      for (const [key, envKey] of Object.entries(envMap)) {
        if (body[key] === undefined) continue
        const value = String(body[key] ?? "")
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
      const memPercent = parseFloat(status.match(/VmRSS:\s+(\d+)/) ? (rss / (readFileSync("/proc/meminfo", "utf8").match(/MemTotal:\s+(\d+)/)?.[1] || 1) * 100).toFixed(1) : "0")
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

function getTzTime() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false
  })
}

const staticAssetExts = new Set([".js", ".mjs", ".css", ".json", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".webmanifest", ".map"])

function isStaticAsset(pathname) {
  if (pathname.startsWith("/assets/")) return true
  if (pathname.startsWith("/@vite/")) return true
  if (pathname === "/__vite_ping" || pathname === "/@vite/client") return true
  if (staticAssetExts.has(extname(pathname))) return true
  return false
}

Bun.serve({
  hostname: webHost,
  port: webPort,
  idleTimeout: 255,
  maxRequestBodySize: Number.MAX_SAFE_INTEGER,
  async fetch(req, server) {
    const url = new URL(req.url, "http://localhost")
    const start = Date.now()

    try {
      if (url.pathname === "/login" && req.method === "GET") {
        return new Response(loginPageHtml, { headers: { "Content-Type": "text/html" } })
      }

      if (url.pathname === "/session-not-found" && req.method === "GET") {
        const dir = url.searchParams.get("dir") || ""
        const backHref = dir ? `/${dir}/session` : "/"
        return new Response(sessionNotFoundHtml(backHref), { headers: { "Content-Type": "text/html" } })
      }

      const isPublicApi = url.pathname === "/api/login" || url.pathname === "/api/logout"
      const noRenewPaths = ["/api/stats/heartbeat"]
      const shouldRenew = !noRenewPaths.includes(url.pathname)
      if (authEnabled && !isPublicApi && !isStaticAsset(url.pathname)) {
        const session = getSession(req, shouldRenew)
        if (!session) {
          if (url.pathname.startsWith("/api/") || req.headers.get("accept")?.includes("application/json")) {
            return jsonResponse({ error: "Not authenticated" }, 401)
          }
          return redirectToLogin()
        }
        if (url.pathname === "/admin.html" && session.role === "user") {
          return new Response(null, { status: 302, headers: { "Location": "/" } })
        }
      }

      const apiRes = await handleAPI(req, server)
      if (apiRes) {
        console.log(`[${getTzTime()}] ${req.method} ${url.pathname} -> middleware ${apiRes.status} ${Date.now() - start}ms`)
        return apiRes
      }

      const staticResult = serveStatic(url.pathname)
      if (staticResult) {
        return new Response(staticResult.content, { headers: { "Content-Type": staticResult.mime } })
      }

      if (isCompiled && embeddedFiles && embeddedFiles["/index.html"]) {
        console.log(`[${getTzTime()}] ${req.method} ${url.pathname} -> spa-fallback ${Date.now() - start}ms`)
        return new Response(Buffer.from(embeddedFiles["/index.html"].content, "base64"), { headers: { "Content-Type": "text/html" } })
      }

      if (!isCompiled) {
        const indexPath = join(distDir, 'index.html')
        if (existsSync(indexPath)) {
          console.log(`[${getTzTime()}] ${req.method} ${url.pathname} -> spa-fallback ${Date.now() - start}ms`)
          return new Response(readFileSync(indexPath), { headers: { "Content-Type": "text/html" } })
        }
      }

      console.log(`[${getTzTime()}] ${req.method} ${url.pathname} -> 404 ${Date.now() - start}ms`)
      return new Response("Not Found", { status: 404 })
    } catch (error) {
      console.error(`[${getTzTime()}][error] ${req.method} ${url.pathname} -> ${error.message}`)
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
    console.log(`[${getTzTime()}] rotated, previous size: ${(size / 1024 / 1024).toFixed(1)}MB`)
  } catch {}
}
setInterval(rotateLog, 600000)
rotateLog()

console.log(`[${getTzTime()}] Production server listening on ${webHost}:${webPort}`)
console.log(`[${getTzTime()}] Static files from: ${isCompiled ? "embedded" : distDir}`)
console.log(`[${getTzTime()}] Stats data: ${dbPath}`)
