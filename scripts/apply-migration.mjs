// Apply a single SQL migration file to the live DB via SUPABASE_DB_URL.
// Usage: node scripts/apply-migration.mjs supabase/migrations/0002_carry_in_points.sql
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = resolve(here, '..')
  const raw = readFileSync(resolve(root, '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const [, k, v] = m
    let val = v
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = val
  }
  return root
}

// Parse a postgres URL whose password may contain raw special characters.
function parsePgUrl(url) {
  const schemeMatch = url.match(/^([a-z]+):\/\//i)
  if (!schemeMatch) throw new Error('not a postgres URL')
  const after = url.slice(schemeMatch[0].length)
  const lastAt = after.lastIndexOf('@')
  if (lastAt < 0) throw new Error('no @ in URL')
  const userinfo = after.slice(0, lastAt)
  const hostPart = after.slice(lastAt + 1)
  const firstColon = userinfo.indexOf(':')
  const user = firstColon < 0 ? userinfo : userinfo.slice(0, firstColon)
  const password = firstColon < 0 ? '' : userinfo.slice(firstColon + 1)
  const qIdx = hostPart.indexOf('?')
  const beforeQuery = qIdx < 0 ? hostPart : hostPart.slice(0, qIdx)
  const slashIdx = beforeQuery.indexOf('/')
  const hostport = slashIdx < 0 ? beforeQuery : beforeQuery.slice(0, slashIdx)
  const database = slashIdx < 0 ? '' : beforeQuery.slice(slashIdx + 1)
  const [host, portStr] = hostport.split(':')
  const port = portStr ? parseInt(portStr, 10) : 5432
  return { host, port, user, password, database }
}

const root = loadEnv()
const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/apply-migration.mjs <path-to-sql>')
  process.exit(1)
}
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL not set in .env.local')
  process.exit(1)
}
const cfg = parsePgUrl(url)
console.log(`connecting host=${cfg.host} port=${cfg.port} db=${cfg.database}`)
const sql = readFileSync(resolve(root, file), 'utf8')
const client = new Client({
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query(sql)
  console.log(`Applied ${file}`)
} finally {
  await client.end()
}
