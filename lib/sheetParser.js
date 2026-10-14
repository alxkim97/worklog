// Parses the APm production plan (Google Sheet "PLAN" tab) into task rows.
// Pure function: rows in, tasks out — no network, so it can be tested against
// saved snapshots (test/sheetParser.test.js).
//
// Layout (2026 sheet):
//   - "SEPTEMBER/2026"-style month header rows
//   - a week header row per week: day numbers at a fixed stride (5 columns
//     per day), e.g. 21@C 22@H 23@M …
//   - then one block of rows per process step, step name in column B
//     (Disp, Mix, Tab, Capsule, Coat, Mix, Mix, Bottle, Strip, Blister,
//     Powder, Fill Cream, Fill Liquid, Packing); rows with an empty B continue
//     the step above (more machines/lines).
//   - each day's 5 columns: [line, product, note, count, count]. Disp rows put
//     the product in the first column instead (no line).
//
// Only sheet-owned fields are returned — status / notes / priority / assignee
// belong to the user and the sync never sends them.

import { STEPS } from './depts.js'

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const SKIP = new Set(['Clean', 'clean', 'รวม', 'Total'])
const LINE = /^(\d{1,2}|B|RD|Semi)$/

// "Mix" appears three times a week: solids, then cream, then liquid.
const MIX_DEPTS = ['tablets', 'cream', 'liquid']
const STEP_DEPT = {
  Disp: 'disp',
  Tab: 'tablets', Capsule: 'tablets', Coat: 'tablets', Powder: 'tablets',
  'Fill Cream': 'cream',
  'Fill Liquid': 'liquid',
  Bottle: 'packing', Strip: 'packing', Blister: 'packing', Packing: 'packing',
}
const STEP_SET = new Set(['Disp', ...STEPS])

const pad = n => String(n).padStart(2, '0')
const daysIn = (y, m) => new Date(y, m, 0).getDate()
const isJunk = s => !s || SKIP.has(s) || /^\d+$/.test(s) || LINE.test(s)

// A week header: ≥5 day numbers at an even column stride, each the day after
// the previous one (rolling over to 1 at month end). Packing rows full of
// batch counts look similar but fail one of these checks.
function weekHeader(cells) {
  const c = []
  cells.forEach((v, col) => { if (/^\d{1,2}$/.test(v) && +v >= 1 && +v <= 31) c.push({ col, day: +v }) })
  if (c.length < 5) return null
  const stride = c[1].col - c[0].col
  if (stride < 2) return null
  for (let i = 1; i < c.length; i++) {
    if (c[i].col - c[i - 1].col !== stride) return null
    const prev = c[i - 1].day, d = c[i].day
    if (!(d === prev + 1 || (d === 1 && prev >= 28))) return null
  }
  return c
}

// "P-400 50x10's (C) (51-54)" → "51-54": the last bracket of digits.
function lotOf(product) {
  const all = [...product.matchAll(/\((\d{2,3}(?:\s*-\s*\d{2,3})?)\)/g)]
  return all.length ? all[all.length - 1][1].replace(/\s/g, '') : null
}

export function parseSheet(rows) {
  const tasks = []
  const seen = new Set()
  let headerMonth = null, headerYear = null, fresh = false
  let last = null            // { y, m, d } of the previous week's last day
  let week = []              // [{ col, date }]
  let step = '', mixCount = 0

  for (const row of rows || []) {
    if (!row || !row.length) continue
    const cells = row.map(c => String(c ?? '').trim())

    const mh = cells.join(' ').match(/\b([A-Za-z]{3,9})\/(\d{4})\b/)
    if (mh && MONTHS[mh[1].slice(0, 3).toLowerCase()]) {
      headerMonth = MONTHS[mh[1].slice(0, 3).toLowerCase()]
      headerYear = Number(mh[2])
      fresh = true
      continue
    }
    if (!headerMonth) continue

    const wh = weekHeader(cells)
    if (wh) {
      const wraps = wh.some((x, i) => i && x.day < wh[i - 1].day)
      let y, m
      if (fresh || !last) {
        // First week under a month header: if it straddles the boundary, the
        // days before the wrap belong to the month before the header.
        m = wraps ? headerMonth - 1 : headerMonth
        y = headerYear
      } else {
        // Later weeks continue from the previous one.
        m = last.m; y = last.y
        if (wh[0].day <= last.d) m++
      }
      if (m < 1) { m = 12; y-- }
      if (m > 12) { m = 1; y++ }
      week = []
      wh.forEach((x, i) => {
        if (i && x.day < wh[i - 1].day) { m++; if (m > 12) { m = 1; y++ } }
        week.push({ col: x.col, date: `${y}-${pad(m)}-${pad(x.day)}`, y, m, d: x.day })
      })
      const end = week[week.length - 1]
      last = { y: end.y, m: end.m, d: end.d }
      fresh = false
      step = ''; mixCount = 0
      continue
    }
    if (!week.length) continue

    if (cells[1] && STEP_SET.has(cells[1])) {
      step = cells[1]
      if (step === 'Mix') mixCount++
    }
    if (!step) continue
    const dept = step === 'Mix' ? MIX_DEPTS[Math.min(mixCount, 3) - 1] : (STEP_DEPT[step] || 'other')
    const isDisp = step === 'Disp'

    for (const { col, date } of week) {
      const line = isDisp ? '' : (LINE.test(cells[col]) ? cells[col] : '')
      const raw = isDisp ? cells[col] : cells[col + 1]
      if (!raw || isJunk(raw)) continue

      // Two products in one cell (Alt+Enter in Sheets) become two tasks.
      for (let product of raw.split('\n').map(s => s.trim())) {
        product = product.replace(/\s*\/\s*clean\s*$/i, '').trim() // "X/clean" = X, then clean the line
        if (isJunk(product)) continue
        const ref = `${date}|${dept}|${step}|${line}|${product}`
        if (seen.has(ref)) continue
        seen.add(ref)
        const label = step === 'Disp' ? null : step
        tasks.push({
          sheet_ref: ref,
          source: 'sheet',
          title: label ? `[${label}] ${product}` : product,
          type: /\bPV\s*\d*\b/i.test(product) ? 'pv_lot' : 'production',
          due_date: date,
          product_name: product,
          lot_number: lotOf(product),
          section: dept,
          step: label,
          sheet_path: [step, line && (line === 'RD' ? 'R&D line' : `line ${line}`)].filter(Boolean).join(' · '),
        })
      }
    }
  }
  return tasks
}
