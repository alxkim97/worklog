// Saves the live PLAN tab to test/fixtures/plan-<date>.private.json (gitignored)
// and prints what the parser makes of it. Needs .secrets/google-sa.json.
// Usage: node scripts/snapshot-sheet.js
import { readFileSync, writeFileSync } from 'node:fs'
import { googleToken, fetchPlanRows } from '../lib/sheetSync.js'
import { parseSheet } from '../lib/sheetParser.js'

const SHEET_ID = process.env.SHEET_ID || '1GpGLBMrMC3OdVS8alpghKgTn_8PPG7hvT49XQJOrzNc'
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
