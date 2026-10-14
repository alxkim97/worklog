// Saves every row of WorkLog's tables to backups/<timestamp>.json.
// Usage: node scripts/backup.js   (reads SUPABASE_URL + SUPABASE_KEY from
// .env.local — anon key works while v1's open policies are still in place;
// after the v2 lock-down use the service_role key here instead.)
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const env = Object.fromEntries((existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '')
  .split(/\r?\n/).map(l => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, '')]))
const url = process.env.SUPABASE_URL || env.SUPABASE_URL
const key = process.env.SUPABASE_KEY || env.SUPABASE_KEY
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_KEY in .env.local'); process.exit(1) }

const supa = createClient(url, key, { auth: { persistSession: false } })
const out = {}
for (const table of ['work_tasks', 'work_date_notes']) {
  out[table] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supa.from(table).select('*').range(start, start + 999)
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1) }
    out[table].push(...data)
    if (data.length < 1000) break
  }
  console.log(`${table}: ${out[table].length} rows`)
}
mkdirSync('backups', { recursive: true })
const file = `backups/worklog-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify(out, null, 1))
console.log(`Saved ${file}`)
