#!/usr/bin/env node

/**
 * Session Cleanup Script
 * 
 * Usage: node session-cleanup.js [options]
 * 
 * Options:
 *   --inactive          Clean inactive sessions (not archived, not updated in N days) [DEFAULT]
 *   --archived          Clean archived sessions (archived more than N days ago)
 *   --orphans           Clean orphan upload directories (session no longer exists in database)
 *   --days <number>     Days threshold (default: 14 for inactive, 7 for archived)
 *   --all               Clean ALL matching sessions (ignores time threshold)
 *   --db <path>         Database path (default: ~/.local/share/opencode/opencode.db)
 *   --dry-run           Show what would be deleted without actually deleting
 *   --help              Show help
 */

import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { existsSync, rmSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packagesDir = dirname(scriptDir)
const projectRoot = dirname(packagesDir)
const envPath = join(projectRoot, ".env")
const envVars = {}
if (existsSync(envPath)) {
  const envContent = await Bun.file(envPath).text()
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
const serverPort = envVars.VITE_OPENCODE_SERVER_PORT || "4096"
const serverUrl = `http://${serverHost}:${serverPort}`
const webHost = envVars.WEB_HOST || "0.0.0.0"
const webPort = envVars.WEB_PORT || "3000"
const webUrl = `http://${webHost}:${webPort}`

const getTzTime = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })

const args = process.argv.slice(2)

let mode = "inactive" // default mode
let days = null // will be set based on mode
let dbPath = join(homedir(), ".local/share/opencode/opencode.db")
let dryRun = false
let cleanAll = false

const validOptions = new Set(["--inactive", "--archived", "--orphans", "--days", "--db", "--dry-run", "--all", "--help"])

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--inactive") {
    mode = "inactive"
  } else if (args[i] === "--archived") {
    mode = "archived"
  } else if (args[i] === "--orphans") {
    mode = "orphans"
  } else if (args[i] === "--days") {
    const daysArg = parseInt(args[++i])
    if (isNaN(daysArg) || daysArg < 0) {
      console.error(`Invalid value for --days: ${args[i]}`)
      process.exit(1)
    }
    days = daysArg
  } else if (args[i] === "--db") {
    dbPath = args[++i]
    if (!dbPath) {
      console.error(`--db requires a path argument`)
      process.exit(1)
    }
  } else if (args[i] === "--dry-run") {
    dryRun = true
  } else if (args[i] === "--all") {
    cleanAll = true
  } else if (args[i] === "--help") {
console.log(`
Session Cleanup Script

Usage: bun session-cleanup.js [options]

Modes:
  --inactive          Clean inactive sessions (not archived, not updated in N days)
                        This is the DEFAULT mode if no mode is specified.
  --archived          Clean ALL archived sessions
  --orphans           Clean orphan upload directories (session no longer exists in database)
                        Scans uploads directory and removes directories for deleted sessions.

Options:
  --days <number>     Days threshold for inactive mode (default: 14)
  --all               Clean ALL unarchived sessions (ignores time threshold, inactive mode only)
  --db <path>         Database path (default: ~/.local/share/opencode/opencode.db)
  --dry-run           Show what would be deleted without actually deleting
  --help              Show help

Note:
  Uploads directory is automatically determined:
  - Reads VITE_OPENCODE_DEFAULT_DIR from .env file (project root)
  - Falls back to ~/.local/share/opencode/uploads

Examples:
  # Clean sessions not updated in 14 days (default)
  bun session-cleanup.js

  # Clean sessions not updated in 30 days
  bun session-cleanup.js --days 30

  # Clean ALL unarchived sessions (ignores time)
  bun session-cleanup.js --all

  # Clean all archived sessions
  bun session-cleanup.js --archived
  
  # Clean orphan upload directories
  bun session-cleanup.js --orphans
  
  # Preview orphan cleanup
  bun session-cleanup.js --orphans --dry-run

  # Preview what would be deleted
  bun session-cleanup.js --dry-run
`)
    process.exit(0)
  } else if (args[i].startsWith("-")) {
    console.error(`Unknown option: ${args[i]}`)
    console.error(`Run 'bun session-cleanup.js --help' for usage.`)
    process.exit(1)
  } else {
    console.error(`Unknown argument: ${args[i]}`)
    console.error(`Run 'bun session-cleanup.js --help' for usage.`)
    process.exit(1)
  }
}

// Set default days for inactive mode
if (days === null && mode === "inactive") {
  days = 14
}

if (!existsSync(dbPath)) {
  console.error(`[${getTzTime()}] Database not found: ${dbPath}`)
  process.exit(1)
}

const db = new Database(dbPath)

let sessions

if (mode === "inactive") {
  if (cleanAll) {
    console.log(`[${getTzTime()}] Cleaning up ALL unarchived sessions (ignoring activity threshold)`)
    console.log(`[${getTzTime()}] Warning: This will delete active sessions too! Use --days N to preserve active sessions.`)
    
    sessions = db.query(`
      SELECT id, directory, title, time_updated 
      FROM session 
      WHERE time_archived IS NULL
    `).all()
  } else {
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000
    console.log(`[${getTzTime()}] Cleaning up inactive sessions (not archived, not updated in ${days} days)`)
    console.log(`[${getTzTime()}] Threshold: ${new Date(threshold).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`)
    
    sessions = db.query(`
      SELECT id, directory, title, time_updated 
      FROM session 
      WHERE time_archived IS NULL AND time_updated < ?
    `).all(threshold)
  }
} else if (mode === "archived") {
  sessions = db.query(`
    SELECT id, directory, title, time_archived 
    FROM session 
    WHERE time_archived IS NOT NULL
  `).all()
  console.log(`[${getTzTime()}] Cleaning up ALL archived sessions`)
} else if (mode === "orphans") {
  console.log(`[${getTzTime()}] Cleaning up orphan upload directories`)
  
  const baseDir = process.env.VITE_OPENCODE_DEFAULT_DIR
  if (!baseDir) {
    console.error(`[${getTzTime()}] VITE_OPENCODE_DEFAULT_DIR not configured`)
    console.error(`[${getTzTime()}] Set it in .env file or export as environment variable`)
    process.exit(1)
  }
  
  if (!existsSync(baseDir)) {
    console.log(`[${getTzTime()}] Base directory not found: ${baseDir}`)
    console.log(`[${getTzTime()}] No orphan directories to cleanup`)
    db.close()
    process.exit(0)
  }
  
  // Scan all client IP directories under baseDir
  const clientDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => join(baseDir, dirent.name))
  
  if (clientDirs.length === 0) {
    console.log(`[${getTzTime()}] No client directories found under: ${baseDir}`)
    db.close()
    process.exit(0)
  }
  
  console.log(`[${getTzTime()}] Found ${clientDirs.length} client directories under: ${baseDir}`)
  
  // Get all session IDs from database
  const dbSessionIds = db.query(`SELECT id FROM session`).all().map(row => row.id)
  const dbSessionSet = new Set(dbSessionIds)
  
  let totalOrphans = 0
  const orphanList = []
  
  // Check each client directory's uploads folder
  for (const clientDir of clientDirs) {
    const uploadsPath = join(clientDir, "uploads")
    
    if (!existsSync(uploadsPath)) {
      continue
    }
    
    const uploadDirs = readdirSync(uploadsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
    
    for (const sessionId of uploadDirs) {
      if (!dbSessionSet.has(sessionId)) {
        orphanList.push({
          sessionId,
          path: join(uploadsPath, sessionId),
          clientDir
        })
        totalOrphans++
      }
    }
  }
  
  console.log(`[${getTzTime()}] Found ${totalOrphans} orphan directories across all clients`)
  
  if (totalOrphans === 0) {
    console.log(`[${getTzTime()}] No orphan directories to cleanup`)
    db.close()
    process.exit(0)
  }
  
  if (dryRun) {
    console.log(`[${getTzTime()}] Orphan directories that would be deleted:`)
    for (const orphan of orphanList) {
      console.log(`[${getTzTime()}]   - ${orphan.sessionId}: ${orphan.path} (client: ${orphan.clientDir})`)
    }
    console.log(`[${getTzTime()}] Total: ${totalOrphans} orphan directories`)
    db.close()
    process.exit(0)
  }
  
  // Delete orphan directories
  let deleted = 0
  let failed = 0
  
  for (const orphan of orphanList) {
    try {
      rmSync(orphan.path, { recursive: true, force: true })
      deleted++
      console.log(`[${getTzTime()}] Deleted orphan directory: ${orphan.sessionId} (${orphan.path})`)
    } catch (error) {
      failed++
      console.error(`[${getTzTime()}] Failed to delete ${orphan.sessionId}: ${error.message}`)
    }
  }
  
  console.log(`[${getTzTime()}] Cleanup completed: ${deleted} deleted, ${failed} failed`)
  db.close()
  process.exit(0)
}

console.log(`[${getTzTime()}] Found ${sessions.length} sessions to delete`)

if (sessions.length === 0) {
  console.log(`[${getTzTime()}] No sessions to cleanup`)
  db.close()
  process.exit(0)
}

console.log(`[${getTzTime()}] Uploads directory: uses session.directory + /uploads`)

if (dryRun) {
  console.log(`[${getTzTime()}] Sessions that would be deleted:`)
  for (const session of sessions) {
    const timeField = mode === "inactive" ? session.time_updated : session.time_archived
    const timeLabel = mode === "inactive" ? "last updated" : "archived"
    const uploadPath = join(session.directory, "uploads", session.id)
    const hasUploads = existsSync(uploadPath)
    console.log(
      `[${getTzTime()}]   - ${session.id}: "${session.title}" (${timeLabel}: ${new Date(timeField).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}, dir: ${session.directory})${hasUploads ? ` [uploads: ${uploadPath}]` : ""}`,
    )
  }
  console.log(`[${getTzTime()}] Total: ${sessions.length} sessions`)
  db.close()
  process.exit(0)
}

// Delete sessions via API
let deleted = 0
let failed = 0

for (const session of sessions) {
  try {
    const timeField = mode === "inactive" ? session.time_updated : session.time_archived
    const timeLabel = mode === "inactive" ? "last updated" : "archived"
    
    const deleteUrl = `${serverUrl}/session/${session.id}?directory=${encodeURIComponent(session.directory)}`
    const res = await fetch(deleteUrl, { method: "DELETE" })
    if (!res.ok) {
      const body = await res.text()
      failed++
      console.error(`[${getTzTime()}] Failed to delete ${session.id}: API returned ${res.status} ${body}`)
      continue
    }
    
    await fetch(`${webUrl}/api/stats/session-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionID: session.id }),
    }).catch(() => {})
    
    const uploadPath = join(session.directory, "uploads", session.id)
    if (existsSync(uploadPath)) {
      rmSync(uploadPath, { recursive: true, force: true })
      console.log(`[${getTzTime()}] Deleted uploads: ${uploadPath}`)
    }
    
    deleted++
    console.log(
      `[${getTzTime()}] Deleted: ${session.id} "${session.title}" (${timeLabel}: ${new Date(timeField).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}, dir: ${session.directory})`,
    )
  } catch (error) {
    failed++
    console.error(`[${getTzTime()}] Failed to delete ${session.id}: ${error.message}`)
  }
}

console.log(`[${getTzTime()}] Cleanup completed: ${deleted} deleted, ${failed} failed`)

if (deleted > 0 && !dryRun) {
  console.log(`[${getTzTime()}] Running VACUUM to reclaim disk space...`)
  try {
    db.exec("VACUUM;")
    console.log(`[${getTzTime()}] VACUUM completed`)
  } catch (error) {
    console.error(`[${getTzTime()}] VACUUM failed: ${error.message}`)
  }
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);")
    console.log(`[${getTzTime()}] WAL checkpoint completed`)
  } catch (error) {
    console.error(`[${getTzTime()}] WAL checkpoint failed: ${error.message}`)
  }
}

db.close()