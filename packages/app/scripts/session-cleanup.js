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

// Load .env from project root (packages/app -> packages -> project root)
const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = dirname(scriptDir)
const packagesDir = dirname(appDir)
const projectRoot = dirname(packagesDir)
const envPath = join(projectRoot, ".env")
if (existsSync(envPath)) {
  const envContent = await Bun.file(envPath).text()
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=")
      if (key && valueParts.length > 0) {
        let value = valueParts.join("=")
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        process.env[key] = process.env[key] ?? value
      }
    }
  }
}

const args = process.argv.slice(2)

let mode = "inactive" // default mode
let days = null // will be set based on mode
let dbPath = join(homedir(), ".local/share/opencode/opencode.db")
let uploadsDir = process.env.VITE_OPENCODE_DEFAULT_DIR 
  ? join(process.env.VITE_OPENCODE_DEFAULT_DIR, "uploads")
  : join(homedir(), ".local/share/opencode/uploads")
let dryRun = false
let cleanAll = false

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--inactive") {
    mode = "inactive"
  } else if (args[i] === "--archived") {
    mode = "archived"
  } else if (args[i] === "--orphans") {
    mode = "orphans"
  } else if (args[i] === "--days") {
    const daysArg = parseInt(args[++i])
    days = daysArg >= 0 ? daysArg : null
  } else if (args[i] === "--db") {
    dbPath = args[++i]
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
                        Always keeps the latest session per directory even if inactive.
  --archived          Clean archived sessions (archived more than N days ago)
  --orphans           Clean orphan upload directories (session no longer exists in database)
                        Scans uploads directory and removes directories for deleted sessions.

Options:
  --days <number>     Days threshold (default: 14 for inactive, 7 for archived)
  --all               Clean ALL matching sessions (ignores time threshold)
                        WARNING for --inactive --all: This will delete ALL unarchived sessions
                        except the latest one per directory, including active sessions!
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

  # Clean ALL inactive sessions (ignores time)
  bun session-cleanup.js --all

  # Clean archived sessions older than 7 days
  bun session-cleanup.js --archived --days 7
  
  # Clean orphan upload directories
  bun session-cleanup.js --orphans
  
  # Preview orphan cleanup
  bun session-cleanup.js --orphans --dry-run

  # Preview what would be deleted
  bun session-cleanup.js --dry-run

  # Clean archived sessions older than 7 days (preview)
  bun session-cleanup.js --archived --days 7 --dry-run
`)
    process.exit(0)
  }
}

// Set default days based on mode (orphans doesn't need days)
if (days === null && mode !== "orphans") {
  days = mode === "inactive" ? 14 : 7
}

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`)
  process.exit(1)
}

const db = new Database(dbPath)
db.run("PRAGMA foreign_keys = ON")

let sessions
const threshold = cleanAll ? 0 : Date.now() - days * 24 * 60 * 60 * 1000

if (mode === "inactive") {
  // Get the most recent unarchived session for each directory (to keep at least 1)
  // Using ROW_NUMBER() window function to find the latest session per directory
  const keepIds = db.query(`
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY directory ORDER BY time_updated DESC) as rn
      FROM session
      WHERE time_archived IS NULL
    ) WHERE rn = 1
  `).all().map(row => row.id)
  
  const keepSet = new Set(keepIds)
  
  if (cleanAll) {
    // For --all mode: delete ALL unarchived sessions regardless of activity
    // Only keep the latest one per directory (even if it's inactive)
    console.log(`Cleaning up ALL unarchived sessions (ignoring activity threshold)`)
    console.log(`Note: Keeping only the latest session per directory, others will be deleted`)
    console.log(`Warning: This will delete active sessions too! Use --days N to preserve active sessions.`)
    
    sessions = db.query(`
      SELECT id, directory, title, time_updated 
      FROM session 
      WHERE time_archived IS NULL
    `).all().filter(s => !keepSet.has(s.id))
  } else {
    console.log(`Cleaning up inactive sessions (not archived, not updated in ${days} days)`)
    console.log(`Threshold: ${new Date(threshold).toISOString()}`)
    console.log(`Note: Keeping the latest session per directory even if inactive`)
    
    // Delete inactive sessions except the latest one per directory
    sessions = db.query(`
      SELECT id, directory, title, time_updated 
      FROM session 
      WHERE time_archived IS NULL AND time_updated < ?
    `).all(threshold).filter(s => !keepSet.has(s.id))
  }
} else if (mode === "archived") {
  if (cleanAll) {
    sessions = db.query(`
      SELECT id, directory, title, time_archived 
      FROM session 
      WHERE time_archived IS NOT NULL
    `).all()
    console.log(`Cleaning up ALL archived sessions`)
  } else {
    console.log(`Cleaning up archived sessions (archived more than ${days} days ago)`)
    console.log(`Threshold: ${new Date(threshold).toISOString()}`)
    
    sessions = db.query(`
      SELECT id, directory, title, time_archived 
      FROM session 
      WHERE time_archived IS NOT NULL AND time_archived < ?
    `).all(threshold)
  }
} else if (mode === "orphans") {
  console.log(`Cleaning up orphan upload directories`)
  
  const baseDir = process.env.VITE_OPENCODE_DEFAULT_DIR
  if (!baseDir) {
    console.error("VITE_OPENCODE_DEFAULT_DIR not configured")
    console.error("Set it in .env file or export as environment variable")
    process.exit(1)
  }
  
  if (!existsSync(baseDir)) {
    console.log(`Base directory not found: ${baseDir}`)
    console.log("No orphan directories to cleanup")
    db.close()
    process.exit(0)
  }
  
  // Scan all client IP directories under baseDir
  const clientDirs = readdirSync(baseDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => join(baseDir, dirent.name))
  
  if (clientDirs.length === 0) {
    console.log(`No client directories found under: ${baseDir}`)
    db.close()
    process.exit(0)
  }
  
  console.log(`Found ${clientDirs.length} client directories under: ${baseDir}`)
  
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
  
  console.log(`Found ${totalOrphans} orphan directories across all clients`)
  
  if (totalOrphans === 0) {
    console.log("No orphan directories to cleanup")
    db.close()
    process.exit(0)
  }
  
  if (dryRun) {
    console.log("\nOrphan directories that would be deleted:")
    for (const orphan of orphanList) {
      console.log(`  - ${orphan.sessionId}: ${orphan.path} (client: ${orphan.clientDir})`)
    }
    console.log(`\nTotal: ${totalOrphans} orphan directories`)
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
      console.log(`Deleted orphan directory: ${orphan.sessionId} (${orphan.path})`)
    } catch (error) {
      failed++
      console.error(`Failed to delete ${orphan.sessionId}: ${error.message}`)
    }
  }
  
  console.log(`\nCleanup completed: ${deleted} deleted, ${failed} failed`)
  db.close()
  process.exit(0)
}

console.log(`Found ${sessions.length} sessions to delete`)

if (sessions.length === 0) {
  console.log("No sessions to cleanup")
  db.close()
  process.exit(0)
}

console.log(`Uploads directory: uses session.directory + /uploads`)

if (dryRun) {
  console.log("\nSessions that would be deleted:")
  for (const session of sessions) {
    const timeField = mode === "inactive" ? session.time_updated : session.time_archived
    const timeLabel = mode === "inactive" ? "last updated" : "archived"
    const uploadPath = join(session.directory, "uploads", session.id)
    const hasUploads = existsSync(uploadPath)
    console.log(
      `  - ${session.id}: "${session.title}" (${timeLabel}: ${new Date(timeField).toISOString()}, dir: ${session.directory})${hasUploads ? ` [uploads: ${uploadPath}]` : ""}`,
    )
  }
  console.log(`\nTotal: ${sessions.length} sessions`)
  db.close()
  process.exit(0)
}

// Delete sessions
let deleted = 0
let failed = 0

for (const session of sessions) {
  try {
    const timeField = mode === "inactive" ? session.time_updated : session.time_archived
    const timeLabel = mode === "inactive" ? "last updated" : "archived"
    
    // Delete uploads directory first
    const uploadPath = join(session.directory, "uploads", session.id)
    if (existsSync(uploadPath)) {
      rmSync(uploadPath, { recursive: true, force: true })
      console.log(`Deleted uploads: ${uploadPath}`)
    }
    
    // Delete from session table (cascade will delete messages, parts, etc.)
    db.run("DELETE FROM session WHERE id = ?", [session.id])
    deleted++
    console.log(
      `Deleted: ${session.id} "${session.title}" (${timeLabel}: ${new Date(timeField).toISOString()}, dir: ${session.directory})`,
    )
  } catch (error) {
    failed++
    console.error(`Failed to delete ${session.id}: ${error.message}`)
  }
}

console.log(`\nCleanup completed: ${deleted} deleted, ${failed} failed`)

db.close()