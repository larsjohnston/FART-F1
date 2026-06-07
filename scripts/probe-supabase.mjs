// Probe Supabase REST: list players using anon and service role.
// Reads .env.local manually (same loader pattern as other scripts).
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const raw = readFileSync(resolve(root, '.env.local'), 'utf8')
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (!m) continue
  const [, k, v] = m
  let val = v
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
  if (!process.env[k]) process.env[k] = val
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY

function summarize(name, val) {
  if (!val) return `${name}: <missing>`
  const head = val.slice(0, 14)
  return `${name}: len=${val.length} prefix="${head}..."`
}
console.log(summarize('NEXT_PUBLIC_SUPABASE_URL', url))
console.log(summarize('NEXT_PUBLIC_SUPABASE_ANON_KEY', anon))
console.log(summarize('SUPABASE_SERVICE_ROLE_KEY', svc))

async function probe(label, key) {
  if (!url || !key) { console.log(`${label}: skipped (missing)`); return }
  const c = createClient(url, key, { auth: { persistSession: false } })
  const { data, error, status } = await c.from('players').select('name').limit(4)
  if (error) console.log(`${label}: ERROR status=${status} ${error.message}`)
  else console.log(`${label}: OK rows=${data?.length} -> ${data?.map(r => r.name).join(', ')}`)
}

await probe('anon', anon)
await probe('service', svc)
