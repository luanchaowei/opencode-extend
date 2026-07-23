#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

const scriptDir = dirname(import.meta.dir)
const projectRoot = dirname(scriptDir)
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
      }
    }
  }
}

const statsDir = envVars.VITE_STATS_DATA_PATH || join(homedir(), ".local/share/opencode")
const dbPath = join(statsDir, "stats.db")

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`)
  process.exit(1)
}

const sql = process.argv.slice(2).join(" ")
if (!sql) {
  console.log(`Usage: bun scripts/query-stats.js <sql>`)
  console.log(`  DB:  ${dbPath}`)
  console.log(`Examples:`)
  console.log(`  bun scripts/query-stats.js "SELECT * FROM heartbeats"`)
  console.log(`  bun scripts/query-stats.js "SELECT * FROM daily_stats ORDER BY day_key DESC LIMIT 5"`)
  console.log(`  bun scripts/query-stats.js "SELECT * FROM counters"`)
  process.exit(0)
}

const db = new Database(dbPath, { readonly: true })
try {
  const rows = db.query(sql).all()
  console.log(JSON.stringify(rows, null, 2))
  console.log(`\n${rows.length} row(s)`)
} catch (err) {
  console.error(`Query failed: ${err.message}`)
  process.exit(1)
} finally {
  db.close()
}
