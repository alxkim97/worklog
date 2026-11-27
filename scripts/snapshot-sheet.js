// Saves the live PLAN tab to test/fixtures/plan-<date>.private.json (gitignored)
// and prints what the parser makes of it. Needs .secrets/google-sa.json.
// Usage: node scripts/snapshot-sheet.js
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { googleToken, fetchPlanRows } from '../lib/sheetSync.js'
import { parseSheet } from '../lib/sheetParser.js'

// The sheet ID stays out of this public repo: SHEET_ID in .env.local (gitignored).
for (const line of (existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^\s*(SHEET_ID)\s*=\s*(.*?)\s*$/)
  if (m && !process.env.SHEET_ID) process.env.SHEET_ID = m[2]
}
const SHEET_ID = process.env.SHEET_ID
if (!SHEET_ID) { console.error('Set SHEET_ID in .env.local (same value as Vercel)'); process.exit(1) }
const sa = readFileSync(new URL('../.secrets/google-sa.json', import.meta.url), 'utf8')
const rows = await fetchPlanRows(await googleToken(sa), SHEET_ID)
const file = `test/fixtures/plan-${new Date().toISOString().slice(0, 10)}.private.json`
writeFileSync(file, JSON.stringify(rows))
const tasks = parseSheet(rows)
const count = (k) => tasks.reduce((a, t) => (a[t[k] ?? '—'] = (a[t[k] ?? '—'] || 0) + 1, a), {})
const dates = tasks.map(t => t.due_date).sort()
console.log(`${rows.length} rows → ${tasks.length} tasks, ${dates[0]} … ${dates.at(-1)}`)
console.log('by dept', count('section'))
console.log('by type', count('type'))
console.log('by step', count('step'))
console.log(`saved ${file}`)
