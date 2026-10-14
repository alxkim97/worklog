import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { parseSheet } from '../lib/sheetParser.js'

// Hand-built PLAN tab in the 2026 layout: 5 columns per day starting at C
// ([line, product, note, count, count]); step names in column B.
const day = (line, product, note = '', a = '', b = '') => [line, product, note, a, b]
const blank = ['', '', '', '', '']
const row = (step, ...days) => ['', step, ...days.map(d => d.length === 1 ? blank : d).flat()]
const sheet = [
  ['', '', 'OCTOBER/2026'],
  row('', ['28', '', '', '', ''], ['29', '', '', '', ''], ['30', '', '', '', ''], ['1', '', '', '', ''], ['2', '', '', '', '']),
  row('Disp', ['Para 500 (31)', '', '', '', ''], [''], [''], ['Amox (12)#1', '', '', '', '']),
  row('Mix', day('1', 'Para 500 (31)/clean'), day('1', 'Clean'), day('1', ''), day('1', 'PV2 Vita C (101)')),
  row('', day('RD', 'Zarius tab 1x10\'s(04)')),
  row('Tab', day('1', 'Para 500 (31)'), day('2', 'Gel A\nGel B')),
  row('Coat', day('1', 'เตรียมน้ำยาเคลือบ PV2 Vita C (101)')),
  row('Mix', day('1', 'Cream base (05)')),
  row('Mix', day('1', 'Syrup (07)')),
  row('Packing', day('', 'Box run (09)', '', '6', '')),
  row('', day('', '', '', '12', '15'), day('', '', '', '12', '20'), day('', '', '', '13', '22'), day('', '', '', '9', '26'), day('', '', '', '10', '25')),
  ['', '', 'DECEMBER/2026'],
  row('', ['21', '', '', '', ''], ['22', '', '', '', ''], ['23', '', '', '', ''], ['24', '', '', '', ''], ['25', '', '', '', '']),
  row('Disp', ['Before xmas (03)', '', '', '', '']),
  // next week has no month header of its own (like the real sheet)
  row('', ['28', '', '', '', ''], ['29', '', '', '', ''], ['30', '', '', '', ''], ['31', '', '', '', ''], ['1', '', '', '', '']),
  row('Disp', ['Year end (01)', '', '', '', ''], [''], [''], [''], ['New year (02)', '', '', '', '']),
]

const parsed = parseSheet(sheet)
const by = Object.fromEntries(parsed.map(t => [t.sheet_ref, t]))

test('a week straddling the month header splits across both months', () => {
  assert.ok(by['2026-09-28|disp|Disp||Para 500 (31)'], 'days before the wrap are the previous month')
  assert.ok(by['2026-10-01|disp|Disp||Amox (12)#1'])
})

test('a month-end week with no header of its own continues the month, then rolls into the new year', () => {
  assert.ok(by['2026-12-21|disp|Disp||Before xmas (03)'])
  assert.ok(by['2026-12-28|disp|Disp||Year end (01)'], '28 Dec is December, not November')
  assert.ok(by['2027-01-01|disp|Disp||New year (02)'])
})

test('steps, lines, and the three Mix blocks map to departments', () => {
  const mix = by['2026-09-28|tablets|Mix|1|Para 500 (31)']
  assert.ok(mix, '"/clean" suffix is dropped from the product')
  assert.equal(mix.title, '[Mix] Para 500 (31)')
  assert.equal(mix.sheet_path, 'Mix · line 1')
  assert.equal(by['2026-09-28|tablets|Mix|RD|Zarius tab 1x10\'s(04)'].sheet_path, 'Mix · R&D line')
  assert.ok(by['2026-09-28|cream|Mix|1|Cream base (05)'], 'second Mix block is cream')
  assert.ok(by['2026-09-28|liquid|Mix|1|Syrup (07)'], 'third Mix block is liquid')
  assert.ok(by['2026-09-28|packing|Packing||Box run (09)'])
})

test('PV lots, lot numbers, multi-line cells, junk', () => {
  const pv = by['2026-10-01|tablets|Mix|1|PV2 Vita C (101)']
  assert.equal(pv.type, 'pv_lot')
  assert.equal(pv.lot_number, '101')
  assert.ok(by['2026-09-29|tablets|Tab|2|Gel A'] && by['2026-09-29|tablets|Tab|2|Gel B'])
  assert.ok(!parsed.some(t => /^(Clean|\d+)$/.test(t.product_name)))
})

test('batch-count rows are not mistaken for week headers', () => {
  // If the Packing counts row (12, 12, 13, 9, 10…) were read as a week
  // header, the December rows would shift. They don't:
  assert.ok(by['2026-12-28|disp|Disp||Year end (01)'])
  assert.equal(parsed.filter(t => t.section === 'packing').length, 1)
})

test('never emits user-owned fields', () => {
  for (const t of parsed) for (const k of ['status', 'notes', 'priority', 'assignee']) assert.ok(!(k in t), `${k} leaked`)
})

// Real snapshots (gitignored *.private.json, saved by scripts/snapshot-sheet.js).
const fixtures = (() => { try { return readdirSync(new URL('./fixtures/', import.meta.url)) } catch { return [] } })()
for (const f of fixtures.filter(f => f.endsWith('.json'))) {
  test(`snapshot ${f}: sane dates, unique refs, no Sundays`, () => {
    const tasks = parseSheet(JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')))
    assert.ok(tasks.length > 0)
    assert.equal(new Set(tasks.map(t => t.sheet_ref)).size, tasks.length)
    for (const t of tasks) {
      assert.match(t.due_date, /^\d{4}-\d{2}-\d{2}$/)
      assert.notEqual(new Date(t.due_date + 'T00:00').getDay(), 0, `${t.title} on a Sunday (${t.due_date}) — dates are off`)
    }
  })
}
