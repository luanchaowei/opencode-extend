import { readFileSync, writeFileSync, createWriteStream, mkdirSync, existsSync, unlinkSync, statSync, readdirSync, rmdirSync, realpathSync, renameSync, copyFileSync } from "node:fs"
import { dirname, join, extname } from "node:path"
import { execSync } from "node:child_process"
import { homedir } from "node:os"
import { dict as enDict } from "./src/i18n/en.ts"
import { dict as zhDict } from "./src/i18n/zh.ts"
import solidPlugin from "vite-plugin-solid"

function getLang(req) {
  const acceptLang = req.headers["accept-language"] || ""
  return acceptLang.toLowerCase().startsWith("zh") ? "zh" : "en"
}

function t(lang, key, params) {
  const dict = lang === "zh" ? zhDict : enDict
  let val = dict[key] || enDict[key] || key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(new RegExp(`{{${k}}}`, "g"), v)
    }
  }
  return val
}
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"
import { randomUUID } from "node:crypto"

const getTzTime = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const buildTime = Date.now()
const authEnabled = process.env.AUTH_ENABLED === "true"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

const sessions = new Map()
const SESSION_DURATION = 30 * 60 * 1000

function createSession(userId, username, role) {
  const id = randomUUID()
  sessions.set(id, { userId, username, role, expireAt: Date.now() + SESSION_DURATION })
  return id
}

function getSessionFromReq(req, renew = true) {
  const cookie = req.headers["cookie"] || ""
  const match = cookie.match(/session_id=([^;]+)/)
  if (!match) return null
  const session = sessions.get(match[1])
  if (!session) return null
  if (Date.now() > session.expireAt) { sessions.delete(match[1]); return null }
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
  const s = getSessionFromReq(req)
  return s !== null && (s.role === "admin" || s.role === "super_admin")
}

function requireSuperAdmin(req) {
  if (!authEnabled) return true
  const s = getSessionFromReq(req)
  return s !== null && s.role === "super_admin"
}

const loginPageHtml = `<!DOCTYPE html>
<html lang="zh-CN" style="color-scheme: light">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登录 - GE诊断助手</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf3 100%); color: var(--text-strong, #171717); font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
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
    body { background: linear-gradient(135deg, #0a0a0a 0%, #151528 100%); color: rgba(255,255,255,0.936); }
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
  __REGISTER_LINK__
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

const registerPageHtml = `<!DOCTYPE html>
<html lang="zh-CN" style="color-scheme: light">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>注册 - GE诊断助手</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf3 100%); color: var(--text-strong, #171717); font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
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
  .success-msg { color: #22c55e; font-size: 12px; margin-top: 12px; text-align: center; display: none; }
  .pwd-hint { font-size: 12px; color: #888; margin-top: 6px; line-height: 1.5; }
  .register-link { display: block; text-align: center; margin-top: 16px; font-size: 13px; color: #2563eb; text-decoration: none; }
  .register-link:hover { text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    body { background: linear-gradient(135deg, #0a0a0a 0%, #151528 100%); color: rgba(255,255,255,0.936); }
    .login-box { background: #151515; border-color: #282828; }
    .field input { background: #101010; border-color: #282828; color: rgba(255,255,255,0.936); }
    .pwd-hint { color: #888; }
  }
</style>
</head>
<body>
<div class="login-box">
  <h1>注册账号</h1>
  <form id="register-form">
    <div class="field"><label>用户名</label><input type="text" id="username" autocomplete="username" autofocus><div class="pwd-hint">至少3个字符，只允许大小写字母、数字、中文、下划线</div></div>
    <div class="field">
      <label>密码</label>
      <input type="password" id="password" autocomplete="new-password">
      <div class="pwd-hint">至少8位，需包含数字/大写字母/小写字母/特殊字符中的3种</div>
    </div>
    <div class="field"><label>确认密码</label><input type="password" id="confirmPassword" autocomplete="new-password"></div>
    <button type="submit" class="login-btn" id="register-btn">注册</button>
    <div class="error-msg" id="error-msg"></div>
    <div class="success-msg" id="success-msg"></div>
  </form>
  <a href="/login" class="register-link">已有账号？去登录</a>
</div>
<script>
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = document.getElementById('register-btn')
  const errEl = document.getElementById('error-msg')
  const okEl = document.getElementById('success-msg')
  const username = document.getElementById('username').value.trim()
  const password = document.getElementById('password').value
  const confirmPassword = document.getElementById('confirmPassword').value
  errEl.style.display = 'none'
  okEl.style.display = 'none'
  if (!username || !password) { errEl.textContent = '请填写用户名和密码'; errEl.style.display = 'block'; return }
  if (username.length < 3 || !/^[a-zA-Z0-9\u4e00-\u9fa5_]+$/.test(username)) { errEl.textContent = '用户名至少3个字符，只允许大小写字母、数字、中文、下划线'; errEl.style.display = 'block'; return }
  if (password !== confirmPassword) { errEl.textContent = '两次输入的密码不一致'; errEl.style.display = 'block'; return }
  btn.disabled = true; btn.textContent = '注册中...'
  try {
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
    const data = await res.json()
    if (res.ok) {
      okEl.textContent = '注册成功，即将跳转到登录页...'
      okEl.style.display = 'block'
      setTimeout(() => { window.location.href = '/login' }, 1500)
    } else {
      errEl.textContent = data.error || '注册失败'; errEl.style.display = 'block'
    }
  } catch { errEl.textContent = '网络错误'; errEl.style.display = 'block' }
  btn.disabled = false; btn.textContent = '注册'
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
  body { background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf3 100%); color: var(--text-strong, #171717); font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
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

const staticAssetExts = new Set([".js", ".mjs", ".css", ".json", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".webmanifest", ".map"])
const noAuthPaths = new Set(["/login", "/register", "/api/login", "/api/register", "/oc-theme-preload.js"])

function isStaticAsset(pathname) {
  if (pathname.startsWith("/assets/")) return true
  if (pathname.startsWith("/@vite/")) return true
  if (pathname === "/__vite_ping" || pathname === "/@vite/client") return true
  if (staticAssetExts.has(extname(pathname))) return true
  return false
}

function sendJson(res, data, status = 200, extraHeaders = {}) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v)
  res.end(JSON.stringify(data))
}

function sendRedirect(res, location) {
  res.statusCode = 302
  res.setHeader("Location", location)
  res.end()
}

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

function getAllowedDir(req) {
  if (!authEnabled) return "*"
  const baseDir = process.env.VITE_OPENCODE_DEFAULT_DIR || ""
  const s = getSessionFromReq(req)
  if (!s) return null
  if (s.role === "admin" || s.role === "super_admin") return "*"
  return `${baseDir}/${s.username}`
}

async function doViteModelTest(providerID, modelID, backendUrl, authHeader, defaultDir, timeout) {
  const lang = "zh"
  let sessionID = null
  if (!defaultDir) {
    statsDbRef.saveModelTestResult(providerID, modelID, 2, t(lang, "model.test.missingDir"), 0)
    return
  }
  console.log(`[${getTzTime()}] model test start: ${providerID}/${modelID}`)
  try {
    const sessionRes = await fetch(`${backendUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeader ? { Authorization: authHeader } : {}) },
      body: JSON.stringify({ directory: defaultDir, title: "model-test" }),
    })
    if (!sessionRes.ok) {
      const errText = await sessionRes.text()
      console.error(`[${getTzTime()}] model test ${providerID}/${modelID}: session create failed ${sessionRes.status}`)
      statsDbRef.saveModelTestResult(providerID, modelID, 2, t(lang, "model.test.sessionCreateFailed", { status: sessionRes.status, text: errText }), 0)
      return
    }
    const sessionData = await sessionRes.json()
    sessionID = sessionData.id
    if (!sessionID) {
      console.error(`[${getTzTime()}] model test ${providerID}/${modelID}: no sessionID returned`)
      statsDbRef.saveModelTestResult(providerID, modelID, 2, t(lang, "model.test.sessionNoId"), 0)
      return
    }
    console.log(`[${getTzTime()}] model test ${providerID}/${modelID}: session ${sessionID} created, sending message...`)
    const testStart = Date.now()
    const msgRes = await fetch(`${backendUrl}/session/${sessionID}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeader ? { Authorization: authHeader } : {}) },
      body: JSON.stringify({ model: { providerID, modelID }, parts: [{ type: "text", text: "hi" }] }),
      signal: AbortSignal.timeout(timeout),
    })
    const durationMs = Date.now() - testStart
    if (msgRes.ok) {
      console.log(`[${getTzTime()}] model test ${providerID}/${modelID}: success (${durationMs}ms)`)
      statsDbRef.saveModelTestResult(providerID, modelID, 1, "", durationMs)
    } else {
      const errText = await msgRes.text()
      let errMsg = errText
      try { errMsg = JSON.parse(errText).error || errMsg } catch {}
      console.error(`[${getTzTime()}] model test ${providerID}/${modelID}: failed (${durationMs}ms) ${errMsg}`)
      statsDbRef.saveModelTestResult(providerID, modelID, 2, errMsg, durationMs)
    }
  } catch (err) {
    const errMsg = err.name === "TimeoutError" ? t(lang, "model.test.timeout", { sec: timeout / 1000 }) : err.message
    console.error(`[${getTzTime()}] model test ${providerID}/${modelID}: error: ${errMsg}\n${err.stack}`)
    statsDbRef.saveModelTestResult(providerID, modelID, 2, errMsg, 0)
  } finally {
    if (sessionID) {
      console.log(`[${getTzTime()}] model test ${providerID}/${modelID}: cleanup session ${sessionID}`)
      try {
        await fetch(`${backendUrl}/session/${sessionID}?directory=${encodeURIComponent(defaultDir)}`, {
          method: "DELETE",
          headers: authHeader ? { Authorization: authHeader } : {},
          signal: AbortSignal.timeout(5000),
        })
      } catch {}
    }
  }
}

let statsDbRef = null

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:auth",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost")

        if (url.pathname === "/login" && req.method === "GET") {
          if (!authEnabled) { sendRedirect(res, "/"); return }
          res.setHeader("Content-Type", "text/html")
          res.end(loginPageHtml.replace("__REGISTER_LINK__",
            process.env.VITE_REGISTRATION_ENABLED === "true" ? '<a href="/register" class="register-link" style="display:block;text-align:center;margin-top:16px;font-size:13px;color:#2563eb;text-decoration:none">没有账号？去注册</a>' : ""))
          return
        }

        if (url.pathname === "/register" && req.method === "GET") {
          if (!authEnabled) { sendRedirect(res, "/"); return }
          if (process.env.VITE_REGISTRATION_ENABLED !== "true") { sendRedirect(res, "/login"); return }
          res.setHeader("Content-Type", "text/html")
          res.end(registerPageHtml)
          return
        }

        if (url.pathname === "/session-not-found" && req.method === "GET") {
          const dir = url.searchParams.get("dir") || ""
          const backHref = dir ? `/${dir}/session` : "/"
          res.setHeader("Content-Type", "text/html")
          res.end(sessionNotFoundHtml(backHref))
          return
        }

        if (url.pathname === "/api/login" && req.method === "POST") {
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const { username, password } = body
            if (!username || !password) { sendJson(res, { error: t(getLang(req), "api.login.missingFields") }, 400); return }
            const user = statsDbRef.verifyUser(username, password)
            if (!user) { sendJson(res, { error: t(getLang(req), "api.login.invalidCredentials") }, 401); return }
            const sid = createSession(user.id, user.username, user.role)
            sendJson(res, { ok: true, username: user.username, role: user.role }, 200, { "Set-Cookie": sessionCookie(sid) })
          } catch (err) { console.error(`[${getTzTime()}] /api/login error: ${err.message}\n${err.stack}`); sendJson(res, { error: err.message }, 500) }
          return
        }

        if (url.pathname === "/api/register" && req.method === "POST") {
          if (!authEnabled || process.env.VITE_REGISTRATION_ENABLED !== "true") { sendJson(res, { error: t(getLang(req), "api.register.disabled") }, 403); return }
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const { username, password } = body
            if (!username || !password) { sendJson(res, { error: t(getLang(req), "api.register.missingFields") }, 400); return }
            const result = statsDbRef.createUser(username, password, "user")
            if (result.error) {
              const lang = getLang(req)
              const msg = result.error === "Username already exists" ? t(lang, "api.register.usernameExists")
                : result.error === "Missing required fields" ? t(lang, "api.register.usernameEmpty")
                : result.error === "Invalid username" ? t(lang, "api.register.usernameInvalid")
                : result.error === "Password must be at least 8 chars with 3 of: digits, lowercase, uppercase, special chars"
                ? t(lang, "api.register.passwordInvalid")
                : result.error
              sendJson(res, { error: msg }, 400)
              return
            }
            sendJson(res, { ok: true })
          } catch (err) { console.error(`[${getTzTime()}] /api/register error: ${err.message}\n${err.stack}`); sendJson(res, { error: err.message }, 500) }
          return
        }

        if (url.pathname === "/api/logout" && req.method === "POST") {
          const cookie = req.headers["cookie"] || ""
          const match = cookie.match(/session_id=([^;]+)/)
          if (match) sessions.delete(match[1])
          sendJson(res, { ok: true }, 200, { "Set-Cookie": clearSessionCookie() })
          return
        }

        if (url.pathname === "/api/auth/me" && req.method === "GET") {
          if (!authEnabled) { sendJson(res, { username: "", role: "" }); return }
          const s = getSessionFromReq(req)
          if (!s) { sendJson(res, { error: "Not authenticated" }, 401); return }
          sendJson(res, { username: s.username, role: s.role, userId: s.userId })
          return
        }

        if (url.pathname === "/api/users" && req.method === "GET") {
          if (!requireSuperAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
          sendJson(res, { users: statsDbRef.listUsers() })
          return
        }

        if (url.pathname === "/api/users" && req.method === "POST") {
          if (!requireSuperAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString())
            const result = statsDbRef.createUser(body.username, body.password, body.role)
            if (result.error) {
              const lang = getLang(req)
              const msg = result.error === "Username already exists" ? t(lang, "api.user.usernameExists")
                : result.error === "Missing required fields" ? t(lang, "api.user.missingFields")
                : result.error === "Invalid username" ? t(lang, "api.user.usernameInvalid")
                : result.error === "Invalid role" ? t(lang, "api.user.roleInvalid")
                : result.error === "Password must be at least 8 chars with 3 of: digits, lowercase, uppercase, special chars"
                ? t(lang, "api.user.passwordInvalid")
                : result.error
              sendJson(res, { error: msg }, 400)
              return
            }
            sendJson(res, { ok: true, user: result })
          } catch (err) { console.error(`[${getTzTime()}] /api/users POST error: ${err.message}\n${err.stack}`); sendJson(res, { error: err.message }, 500) }
          return
        }

        if (url.pathname.startsWith("/api/users/") && req.method === "DELETE") {
          if (!requireSuperAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
          const id = parseInt(url.pathname.split("/").pop())
          if (isNaN(id)) { sendJson(res, { error: "Invalid user ID" }, 400); return }
          const s = getSessionFromReq(req)
          if (s && s.userId === id) { sendJson(res, { error: "Cannot delete yourself" }, 400); return }
          const result = statsDbRef.deleteUser(id)
          if (result.error) { sendJson(res, { error: result.error }, 400); return }
          sendJson(res, { ok: true })
          return
        }

        if (url.pathname.startsWith("/api/users/") && req.method === "PATCH") {
          if (!requireSuperAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
          const id = parseInt(url.pathname.split("/").pop())
          if (isNaN(id)) { sendJson(res, { error: "Invalid user ID" }, 400); return }
          try {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString())
            if (body.password !== undefined) {
              const result = statsDbRef.updateUserPassword(id, body.password)
              if (result.error) { sendJson(res, { error: result.error }, 400); return }
            }
            if (body.role !== undefined) {
              const result = statsDbRef.updateUserRole(id, body.role)
              if (result.error) { sendJson(res, { error: result.error }, 400); return }
            }
            sendJson(res, { ok: true })
          } catch (err) { console.error(`[${getTzTime()}] /api/users PATCH error: ${err.message}\n${err.stack}`); sendJson(res, { error: err.message }, 500) }
          return
        }

        const noRenewPaths = ["/api/stats/heartbeat"]
        const shouldRenew = !noRenewPaths.includes(url.pathname)
        if (authEnabled && !noAuthPaths.has(url.pathname) && !isStaticAsset(url.pathname)) {
          const session = getSessionFromReq(req, shouldRenew)
          if (!session) {
            const accept = req.headers["accept"] || ""
            if (accept.includes("application/json") || url.pathname.startsWith("/api/")) {
              sendJson(res, { error: "Not authenticated" }, 401)
              return
            }
            sendRedirect(res, "/login")
            return
          }
          if (url.pathname === "/admin.html" && session.role === "user") {
            sendRedirect(res, "/")
            return
          }
        }

        next()
      })
    },
  },
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
            const session = authEnabled ? getSessionFromReq(req) : null
            const clientIP = authEnabled ? (session?.username || "unknown") : getClientIP(req)
            const contactAdmin = process.env.VITE_CONTACT_ADMIN || ""
            const contactList = contactAdmin.split('|').filter(line => line.trim())
            const feedbackUrl = process.env.VITE_FEEDBACK_URL || ""
            const caseLibraryDir = process.env.VITE_CASE_LIBRARY_DIR || ""
            res.setHeader("Content-Type", "application/json")
            const helpDocUrl = process.env.VITE_HELP_DOC_URL || ""
            const announcementText = (process.env.VITE_ANNOUNCEMENT_TEXT || "").replace(/\\n/g, "\n")
            const fileTreePollInterval = process.env.VITE_FILE_TREE_POLL_INTERVAL || "5000"
            const heartbeatInterval = process.env.VITE_HEARTBEAT_INTERVAL || "60000"
            const diskUsageThreshold = process.env.VITE_DISK_USAGE_THRESHOLD || "90"
            const defaultDir = process.env.VITE_OPENCODE_DEFAULT_DIR || ""
            const serverHost = process.env.VITE_OPENCODE_SERVER_HOST || ""
            const serverPort = process.env.VITE_OPENCODE_SERVER_PORT || ""
            const serverUsername = process.env.VITE_OPENCODE_SERVER_USERNAME || ""
            const serverPassword = process.env.VITE_OPENCODE_SERVER_PASSWORD || ""
            const hiddenProviders = (process.env.VITE_HIDDEN_PROVIDERS || "").split(",").map(s => s.trim()).filter(Boolean)
            res.end(JSON.stringify({ clientIP, authEnabled, contactAdmin: contactList, feedbackUrl, caseLibraryDir, helpDocUrl, announcementText, fileTreePollInterval, heartbeatInterval, diskUsageThreshold, defaultDir, serverHost, serverPort, serverUsername, serverPassword, hiddenProviders }))
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
                  res.end(JSON.stringify({ error: t(getLang(req), "api.file.diskThreshold", { percent: usePercent, threshold: 90 }) }))
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
      statsDbRef = statsDb

      const adminUsername = process.env.ADMIN_USERNAME || "admin"
      const adminPassword = process.env.ADMIN_PASSWORD || "admin123"
      statsDb.ensureSuperAdmin(adminUsername, adminPassword)

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
            const userId = authEnabled ? (getSessionFromReq(req)?.userId || null) : null
            statsDb.heartbeat(clientIP, sessions, timestamp, userId)
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ ok: true, buildTime }))
          } catch (err) {
            console.error(`[${getTzTime()}] /api/stats/heartbeat error: ${err.message}\n${err.stack}`)
            res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        if (req.url === "/api/stats/session-create" && req.method === "POST") {
          try {
            const body = JSON.parse(await readBody())
            const { clientIP, sessionID, timestamp } = body
            if (!clientIP || !sessionID) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing clientIP or sessionID" })); return }
            const userId = authEnabled ? (getSessionFromReq(req)?.userId || null) : null
            statsDb.sessionCreate(clientIP, sessionID, timestamp, userId)
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            console.error(`[${getTzTime()}] /api/stats/session-create error: ${err.message}\n${err.stack}`)
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
            console.error(`[${getTzTime()}] /api/stats/session-delete error: ${err.message}\n${err.stack}`)
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
            console.error(`[${getTzTime()}] /api/stats/message-send error: ${err.message}\n${err.stack}`)
            res.statusCode = 500; res.end(JSON.stringify({ error: err.message }))
          }
          return
        }

        if (req.url?.startsWith("/api/stats") && req.method === "GET") {
          if (!requireAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }

          const now = Date.now()
          const tenMinAgo = now - 600000

          const { onlineClients, onlineSessions, processingSessions, currentSessions } = statsDb.getOnlineStats(tenMinAgo)
          const baseDir = process.env.VITE_OPENCODE_DEFAULT_DIR || process.cwd()
          for (const s of currentSessions) {
            if (authEnabled && s.user_id) {
              const username = statsDb.getUsernameById(s.user_id)
              s.directory = `${baseDir}/${username || s.clientIP}`
            } else {
              s.directory = `${baseDir}/${s.clientIP}`
            }
          }
          const counters = statsDb.getCounters()
          const statsUrl = new URL(req.url, "http://localhost")
          const range = statsUrl.searchParams.get("range") || "7d"
          const granularity = statsUrl.searchParams.get("granularity") || "day"
          const startDate = statsUrl.searchParams.get("start") || ""
          const endDate = statsUrl.searchParams.get("end") || ""
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

        if (req.url?.startsWith("/api/logs") && req.method === "GET") {
          try {
            if (!requireAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
            const url = new URL(req.url || "/", "http://localhost")
            const type = url.searchParams.get("type") || "frontend"
            const lines = parseInt(url.searchParams.get("lines") || "300")
            let logFile
            if (type === "backend") {
              const rawPath = process.env.VITE_OPENCODE_SERVER_LOG || "~/.local/share/opencode/log/opencode.log"
              logFile = rawPath.startsWith("~") ? rawPath.replace("~", homedir()) : rawPath
            } else {
              logFile = process.env.LOG_PATH || "/tmp/opencode-extend.log"
            }
            if (!existsSync(logFile)) { sendJson(res, { lines: [], error: t(getLang(req), "api.proxy.logNotFound", { path: logFile }) }); return }
            const content = readFileSync(logFile, "utf-8")
            const allLines = content.split("\n").filter(l => l.trim())
            const tail = allLines.slice(-lines)
            sendJson(res, { lines: tail, total: allLines.length })
          } catch (err) {
            console.error(`[${getTzTime()}] GET /api/logs error: ${err.message}\n${err.stack}`)
            sendJson(res, { lines: [], error: err.message })
          }
          return
        }

        if (req.url?.startsWith("/api/system/monitor") && req.method === "GET") {
          try {
            if (!requireAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
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

        if (req.url?.startsWith("/api/models/list") && req.method === "GET") {
          try {
            if (!requireAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
            const serverHost = process.env.VITE_OPENCODE_SERVER_HOST || "127.0.0.1"
            const serverPort = process.env.VITE_OPENCODE_SERVER_PORT || "4096"
            const serverUrl = `http://${serverHost}:${serverPort}`
            const serverPassword = process.env.VITE_OPENCODE_SERVER_PASSWORD || ""
            const serverUsername = process.env.VITE_OPENCODE_SERVER_USERNAME || "opencode"
            const authHeader = serverPassword ? `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")}` : ""
            const r = await fetch(`${serverUrl}/config/providers`, {
              headers: authHeader ? { Authorization: authHeader } : {},
            })
            if (!r.ok) { sendJson(res, { error: `Backend returned ${r.status}` }, r.status); return }
            const data = await r.json()
            const hiddenSet = new Set((process.env.VITE_HIDDEN_PROVIDERS || "").split(",").map(s => s.trim()).filter(Boolean))
            const providers = (data.providers || []).filter(p => !hiddenSet.has(p.id))
            const testResults = new Map()
            for (const row of statsDb.getModelTestResults()) {
              testResults.set(`${row.provider_id}:${row.model_id}`, row)
            }
            const models = []
            for (const p of providers) {
              const pModels = p.models || {}
              for (const [modelID, model] of Object.entries(pModels)) {
                if (model.status === "deprecated") continue
                const tr = testResults.get(`${p.id}:${modelID}`)
                models.push({
                  providerID: p.id, providerName: p.name || p.id, modelID, modelName: model.name || modelID, status: model.status || "active",
                  testResult: tr ? { status: tr.status, error: tr.error || "", durationMs: tr.duration_ms, testedAt: tr.tested_at } : null,
                })
              }
            }
            sendJson(res, { models })
          } catch (error) {
            res.statusCode = 500
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: error.message }))
          }
          return
        }

        if (req.url?.startsWith("/api/models/test-all") && req.method === "POST") {
          try {
            if (!requireAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
            const serverHost = process.env.VITE_OPENCODE_SERVER_HOST || "127.0.0.1"
            const serverPort = process.env.VITE_OPENCODE_SERVER_PORT || "4096"
            const backendUrl = `http://${serverHost}:${serverPort}`
            const serverPassword = process.env.VITE_OPENCODE_SERVER_PASSWORD || ""
            const serverUsername = process.env.VITE_OPENCODE_SERVER_USERNAME || "opencode"
            const authHeader = serverPassword ? `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")}` : ""
            const r = await fetch(`${backendUrl}/config/providers`, { headers: authHeader ? { Authorization: authHeader } : {} })
            if (!r.ok) { sendJson(res, { error: `Backend returned ${r.status}` }, r.status); return }
            const data = await r.json()
            const hiddenSet = new Set((process.env.VITE_HIDDEN_PROVIDERS || "").split(",").map(s => s.trim()).filter(Boolean))
            const models = []
            for (const p of (data.providers || []).filter(p => !hiddenSet.has(p.id))) {
              for (const [modelID, model] of Object.entries(p.models || {})) {
                if (model.status === "deprecated") continue
                models.push({ providerID: p.id, modelID })
              }
            }
            for (const m of models) {
              const existing = statsDb.getModelTestResults().find(r => r.provider_id === m.providerID && r.model_id === m.modelID)
              if (existing && existing.status === 0) continue
              statsDb.setModelTesting(m.providerID, m.modelID)
            }
            const defaultDir = process.env.VITE_OPENCODE_DEFAULT_DIR || ""
            const timeout = parseInt(process.env.VITE_MODEL_TEST_TIMEOUT || "30000", 10)
            ;(async () => {
              for (const m of models) {
                const existing = statsDb.getModelTestResults().find(r => r.provider_id === m.providerID && r.model_id === m.modelID)
                if (existing && existing.status !== 0) continue
                await doViteModelTest(m.providerID, m.modelID, backendUrl, authHeader, defaultDir, timeout)
              }
            })()
            sendJson(res, { success: true, count: models.length })
          } catch (error) {
            console.error(`[${getTzTime()}] POST /api/models/test-all error: ${error.message}\n${error.stack}`)
            sendJson(res, { error: error.message }, 500)
          }
          return
        }

        if (req.url?.startsWith("/api/models/test") && req.method === "POST") {
          try {
            if (!requireAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
            const body = JSON.parse(await readBody())
            const { providerID, modelID } = body
            const lang = getLang(req)
            if (!providerID || !modelID) { sendJson(res, { error: t(lang, "model.test.missingProviderOrModel") }, 400); return }
            const existing = statsDbRef.getModelTestResults().find(r => r.provider_id === providerID && r.model_id === modelID)
            if (existing && existing.status === 0) { sendJson(res, { error: t(lang, "model.test.modelBeingTested") }, 400); return }
            statsDb.setModelTesting(providerID, modelID)
            const serverHost = process.env.VITE_OPENCODE_SERVER_HOST || "127.0.0.1"
            const serverPort = process.env.VITE_OPENCODE_SERVER_PORT || "4096"
            const backendUrl = `http://${serverHost}:${serverPort}`
            const serverPassword = process.env.VITE_OPENCODE_SERVER_PASSWORD || ""
            const serverUsername = process.env.VITE_OPENCODE_SERVER_USERNAME || "opencode"
            const authHeader = serverPassword ? `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")}` : ""
            const defaultDir = process.env.VITE_OPENCODE_DEFAULT_DIR || ""
            const timeout = parseInt(process.env.VITE_MODEL_TEST_TIMEOUT || "30000", 10)
            doViteModelTest(providerID, modelID, backendUrl, authHeader, defaultDir, timeout).catch(err => {
              console.error(`[${getTzTime()}] doViteModelTest error: ${err.message}\n${err.stack}`)
              statsDb.saveModelTestResult(providerID, modelID, 2, err.message, 0)
            })
            sendJson(res, { success: true, async: true })
          } catch (error) {
            console.error(`[${getTzTime()}] POST /api/models/test error: ${error.message}\n${error.stack}`)
            sendJson(res, { error: error.message }, 500)
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
      server.middlewares.use(async (req, res, next) => {
        const readBody = async () => {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          return Buffer.concat(chunks).toString()
        }

        if (req.url?.startsWith("/api/config/runtime") && req.method === "GET") {
          try {
            if (!requireAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({
              announcementText: (process.env.VITE_ANNOUNCEMENT_TEXT || "").replace(/\\n/g, "\n"),
              contactAdmin: process.env.VITE_CONTACT_ADMIN || "",
              feedbackUrl: process.env.VITE_FEEDBACK_URL || "",
              helpDocUrl: process.env.VITE_HELP_DOC_URL || "",
              fileTreePollInterval: process.env.VITE_FILE_TREE_POLL_INTERVAL || "5000",
              heartbeatInterval: process.env.VITE_HEARTBEAT_INTERVAL || "60000",
              diskUsageThreshold: process.env.VITE_DISK_USAGE_THRESHOLD || "90",
              caseLibraryDir: process.env.VITE_CASE_LIBRARY_DIR || "",
              monitorDiskMounts: process.env.VITE_MONITOR_DISK_MOUNTS || "/",
              monitorBackendPattern: process.env.VITE_MONITOR_BACKEND_PATTERN || "",
              monitorFrontendPattern: process.env.VITE_MONITOR_FRONTEND_PATTERN || "",
              hiddenProviders: process.env.VITE_HIDDEN_PROVIDERS || "",
              modelTestTimeout: process.env.VITE_MODEL_TEST_TIMEOUT || "30000",
              authEnabled: process.env.AUTH_ENABLED === "true",
              registrationEnabled: process.env.VITE_REGISTRATION_ENABLED === "true",
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
            if (!requireAdmin(req)) { sendJson(res, { error: "Forbidden" }, 403); return }
            const body = JSON.parse(await readBody())
            const envMap = {
              announcementText: "VITE_ANNOUNCEMENT_TEXT",
              contactAdmin: "VITE_CONTACT_ADMIN",
              feedbackUrl: "VITE_FEEDBACK_URL",
              helpDocUrl: "VITE_HELP_DOC_URL",
              fileTreePollInterval: "VITE_FILE_TREE_POLL_INTERVAL",
              heartbeatInterval: "VITE_HEARTBEAT_INTERVAL",
              diskUsageThreshold: "VITE_DISK_USAGE_THRESHOLD",
              caseLibraryDir: "VITE_CASE_LIBRARY_DIR",
              monitorDiskMounts: "VITE_MONITOR_DISK_MOUNTS",
              monitorBackendPattern: "VITE_MONITOR_BACKEND_PATTERN",
              monitorFrontendPattern: "VITE_MONITOR_FRONTEND_PATTERN",
              hiddenProviders: "VITE_HIDDEN_PROVIDERS",
              modelTestTimeout: "VITE_MODEL_TEST_TIMEOUT",
              registrationEnabled: "VITE_REGISTRATION_ENABLED",
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
              const value = String(body[key] ?? "").replace(/\n/g, "\\n")
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
  {
    name: "opencode-desktop:backend-proxy",
    configureServer(viteServer) {
      if (!authEnabled) return
      const PROXY_PREFIXES = ["/session", "/experimental", "/project", "/config", "/event",
        "/permission", "/question", "/file", "/find", "/path", "/vcs", "/agent",
        "/instance/dispose", "/global/health", "/global/event", "/global/config", "/provider"]

      viteServer.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost")

        if (!PROXY_PREFIXES.some(p => url.pathname.startsWith(p))) {
          next()
          return
        }

        const allowedDir = getAllowedDir(req)
        if (!allowedDir) { sendJson(res, { error: "Not authenticated" }, 401); return }

        const serverHost = process.env.VITE_OPENCODE_SERVER_HOST || "127.0.0.1"
        const serverPort = process.env.VITE_OPENCODE_SERVER_PORT || "4096"
        const backendUrl = `http://${serverHost}:${serverPort}`
        const serverPassword = process.env.VITE_OPENCODE_SERVER_PASSWORD || ""
        const serverUsername = process.env.VITE_OPENCODE_SERVER_USERNAME || "opencode"
        const authHeader = serverPassword ? `Basic ${Buffer.from(`${serverUsername}:${serverPassword}`).toString("base64")}` : ""

        const sessionMatch = url.pathname.match(/^\/session\/([^/]+)/)
        if (sessionMatch && !url.pathname.startsWith("/session/status") && !url.pathname.endsWith("/message")) {
          const sessionID = sessionMatch[1]
          try {
            const checkRes = await fetch(`${backendUrl}/session/${sessionID}?directory=${encodeURIComponent(allowedDir === "*" ? process.env.VITE_OPENCODE_DEFAULT_DIR || "" : allowedDir)}`, {
              headers: authHeader ? { Authorization: authHeader } : {},
              signal: AbortSignal.timeout(5000),
            })
            if (checkRes.ok) {
              const sessionData = await checkRes.json()
              const sessionDir = sessionData.metadata?.directory || sessionData.directory || sessionData.location?.directory || ""
              if (allowedDir !== "*" && sessionDir && sessionDir !== allowedDir) {
                sendJson(res, { error: t(getLang(req), "api.proxy.sessionForbidden") }, 403)
                return
              }
            } else if (checkRes.status === 404) {
              sendJson(res, { error: t(getLang(req), "api.proxy.sessionNotFound") }, 404)
              return
            }
          } catch {}
        }

        const dirHeader = req.headers["x-opencode-directory"]
        const requestedDir = url.searchParams.get("directory")
          || (dirHeader ? decodeURIComponent(dirHeader) : "")
        if (requestedDir && allowedDir !== "*" && requestedDir !== allowedDir) {
          sendJson(res, { error: t(getLang(req), "api.proxy.directoryForbidden") }, 403)
          return
        }

        try {
          const proxyHeaders = { ...req.headers }
          delete proxyHeaders["host"]
          if (authHeader) proxyHeaders["authorization"] = authHeader

          const body = ["GET", "HEAD"].includes(req.method) ? undefined : await new Promise((resolve) => {
            const chunks = []
            req.on("data", (c) => chunks.push(c))
            req.on("end", () => resolve(Buffer.concat(chunks)))
            req.on("error", () => resolve(undefined))
          })

          const proxyRes = await fetch(`${backendUrl}${url.pathname}${url.search}`, {
            method: req.method,
            headers: proxyHeaders,
            body,
          })

          if (url.pathname === "/provider" && proxyRes.ok) {
            const data = await proxyRes.json()
            if (data.all) {
              for (const p of data.all) {
                if (p.key) p.key = "***"
                if (p.options?.apiKey) p.options.apiKey = "***"
              }
            }
            sendJson(res, data, proxyRes.status)
            return
          }

          if (url.pathname === "/project" && allowedDir !== "*" && proxyRes.ok) {
            const data = await proxyRes.json()
            const filtered = Array.isArray(data) ? data.filter(p => p.worktree === allowedDir) : data
            sendJson(res, filtered, proxyRes.status)
            return
          }

          if (url.pathname === "/experimental/session" && allowedDir !== "*" && proxyRes.ok) {
            const data = await proxyRes.json()
            if (data.data && Array.isArray(data.data)) {
              data.data = data.data.filter(s => {
                const dir = s.metadata?.directory || s.directory || s.location?.directory || ""
                return dir === allowedDir
              })
              sendJson(res, data, proxyRes.status)
              return
            } else if (Array.isArray(data)) {
              const filtered = data.filter(s => {
                const dir = s.metadata?.directory || s.directory || s.location?.directory || ""
                return dir === allowedDir
              })
              sendJson(res, filtered, proxyRes.status)
              return
            }
            sendJson(res, data, proxyRes.status)
            return
          }

          res.statusCode = proxyRes.status
          proxyRes.headers.forEach((value, key) => {
            if (key !== "transfer-encoding" && key !== "content-encoding" && key !== "content-length") res.setHeader(key, value)
          })
          const respBuffer = await proxyRes.arrayBuffer()
          res.end(Buffer.from(respBuffer))
        } catch (err) {
          console.error(`[${getTzTime()}] backend-proxy error: ${err.message}\n${err.stack}`)
          sendJson(res, { error: err.message }, 502)
        }
      })
    },
  },
]