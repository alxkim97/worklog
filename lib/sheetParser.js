// Parses the APm production plan (Google Sheet "PLAN" tab, Gantt layout) into
// task rows. Pure function: rows in, tasks out — no network, so it can be
// tested against saved snapshots (test/sheetParser.test.js).
//
// Sheet layout, as the parser understands it:
//   - a month header row containing e.g. "APR/2026"
//   - day header rows: ≥5 unique integers 1–31, one per day column
//   - data rows below: col A = section (Tablets, Cream…), col B = sub-row
//     (Disp, Mix, Tab…). Disp rows put the product in the day column itself;
//     every other row puts it one column to the right.
//
// Only sheet-owned fields are returned. status / notes / priority / assignee
// belong to the user, and the sync must never send them (v1 did, which reset
// every edit on the next sync).

import { deptKey, STEPS } from './depts.js'

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const SKIP = new Set(['B', 'RD', 'Semi', 'Clean', 'รวม', 'Total', ''])
const STEP_SET = new Set(STEPS)

const pad = n => String(n).padStart(2, '0')
const isJunk = s => !s || SKIP.has(s) || /^\d+$/.test(s)

export function parseSheet(rows) {
  const tasks = []
  const seen = new Set()
  let month = null, year = null
  let dayCols = []
  let minDay = 0, maxDay = 0
  let section = '', sub = ''

  for (const row of rows || []) {
    if (!row || !row.length) continue
    const cells = row.map(c => String(c ?? '').trim())

    const mh = cells.join(' ').match(/\b([A-Za-z]{3,9})\/(\d{4})\b/)
    if (mh && MONTHS[mh[1].slice(0, 3).toLowerCase()]) {
      month = MONTHS[mh[1].slice(0, 3).toLowerCase()]
      year = Number(mh[2])
      dayCols = []
      continue
    }
    if (!month) continue

    // Threshold 5 (not 3) so Packing batch-count rows (2–3 numbers) don't
    // get mistaken for a day header and shift every date below them.
    const cands = []
    cells.forEach((v, col) => {
      const n = Number(v)
      if (Number.isInteger(n) && n >= 1 && n <= 31 && String(n) === v) cands.push({ col, day: n })
    })
    if (cands.length >= 5 && new Set(cands.map(c => c.day)).size >= 5) {
      dayCols = cands
      const days = cands.map(c => c.day)
      minDay = Math.min(...days)
      maxDay = Math.max(...days)
      continue
    }
    if (!dayCols.length) continue

    if (cells[0]) section = cells[0]
    if (cells[1]) sub = cells[1]
    const isDisp = sub === 'Disp'
    const dept = deptKey(isDisp ? 'Disp' : section)
    const step = !isDisp && STEP_SET.has(sub) ? sub : null
    const path = [section, isDisp ? 'Disp' : sub].filter(Boolean).join(' › ')

    for (const { col, day } of dayCols) {
      const raw = isDisp ? cells[col] : (cells[col + 1] || '')
      if (isJunk(raw)) continue

      // A week straddling two months: if it starts a month (minDay ≤ 3) the
      // big days belong to the previous month; otherwise the small days
      // belong to the next one.
      let m = month, y = year
      if (maxDay > 20 && minDay < 10) {
        if (minDay <= 3 && day > 20) { m = month === 1 ? 12 : month - 1; if (month === 1) y-- }
        else if (minDay > 3 && day < 10) { m = month === 12 ? 1 : month + 1; if (month === 12) y++ }
      }
      const date = `${y}-${pad(m)}-${pad(day)}`

      // Two products in one cell (Alt+Enter in Sheets) become two tasks.
      for (const product of raw.split('\n').map(s => s.trim()).filter(s => !isJunk(s))) {
        // Dept + step are part of the key: the same product mixed and
        // tableted on the same day is two tasks, not one (v1 merged them).
        const ref = `${date}|${dept}|${step || ''}|${product}`
        if (seen.has(ref)) continue
        seen.add(ref)
        const lot = product.match(/\((\d{2,3})\)/)
        tasks.push({
          sheet_ref: ref,
          source: 'sheet',
          title: step ? `[${step}] ${product}` : product,
          type: /\bPV\d*/i.test(product) ? 'pv_lot' : 'production',
          due_date: date,
          product_name: product,
          lot_number: lot ? lot[1] : null,
          section: dept,
          step,
          sheet_path: path || null,
        })
      }
    }
  }
  return tasks
}
