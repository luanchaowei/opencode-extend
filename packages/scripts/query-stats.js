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

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun scripts/query-stats.js [options] <sql>`)
  console.log(`       bun scripts/query-stats.js --help`)
  console.log()
  console.log(`Query the stats database in read-only mode.`)
  console.log()
  console.log(`Options:`)
  console.log(`  --sql <sql>    SQL statement (alternative to positional argument)`)
  console.log(`  --help, -h     Show this help`)
  console.log()
  console.log(`  DB:  ${dbPath}`)
  console.log()
  console.log(`Examples:`)
  console.log(`  bun scripts/query-stats.js "SELECT * FROM heartbeats"`)
  console.log(`  bun scripts/query-stats.js --sql "SELECT * FROM daily_stats ORDER BY day_key DESC LIMIT 5"`)
  console.log(`  bun scripts/query-stats.js "SELECT * FROM counters"`)
  console.log(`  bun scripts/query-stats.js "SELECT COUNT(*) FROM session_day_seen"`)
  process.exit(0)
}

let sql = ""

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--sql") {
    sql = args[++i] || ""
    if (!sql) {
      console.error(`--sql requires a SQL argument`)
      process.exit(1)
    }
  } else if (args[i] === "--help" || args[i] === "-h") {
    continue
  } else if (args[i].startsWith("-")) {
    console.error(`Unknown option: ${args[i]}`)
    console.error(`Run 'bun scripts/query-stats.js --help' for usage.`)
    process.exit(1)
  } else {
    sql = sql ? sql + " " + args[i] : args[i]
  }
}

if (!sql) {
  console.error(`Error: SQL statement required`)
  console.error(`Run 'bun scripts/query-stats.js --help' for usage.`)
  process.exit(1)
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
