// Saves every row of WorkLog's tables to backups/<timestamp>.json (gitignored).
// Usage: npm run backup
// Uses the same .env.local as the CLI (SUPABASE_SERVICE_ROLE_KEY): the tables
// are members-only, so the public (anon) key would get empty tables back.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

for (const line of (existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
}
process.env.SUPABASE_URL ||= 'https://uhlbrxyvhfmfeakckzlu.supabase.co'
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY is not set in .env.local'); process.exit(1) }
const { adminClient } = await import('../lib/server.js')

const supa = adminClient()
const out = {}
for (const table of ['work_tasks', 'work_date_notes', 'worklog_settings', 'worklog_members']) {
  out[table] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supa.from(table).select('*').order(table === 'worklog_settings' ? 'key' : table === 'worklog_members' ? 'user_id' : 'id').range(start, start + 999)
    if (error) { console.error(`${table}: ${error.message}`); process.exit(1) }
    out[table].push(...data)
    if (data.length < 1000) break
  }
  console.log(`${table}: ${out[table].length} rows`)
}
if (!out.work_tasks.length) { console.error('work_tasks came back empty — not saving (wrong key?)'); process.exit(1) }
mkdirSync('backups', { recursive: true })
const file = `backups/worklog-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify(out, null, 1))
console.log(`Saved ${file}`)
