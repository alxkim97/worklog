import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { parseSheet } from '../lib/sheetParser.js'

// A small hand-built PLAN tab: day columns at 2,4,6,8,10 (product cells sit
// one to the right, except on Disp rows).
const header = ['', '', '28', '', '29', '', '30', '', '1', '', '2', '']
const sheet = [
  ['', 'SEP/2026'],
  header,
  ['Tablets', 'Disp', 'Para 500', '', '', '', '', '', 'Amox (12)', ''],
  ['', 'Mix', '', 'Para 500', '', '', '', 'Total', '', '', '', 'PV1 Vita C (101)'],
  ['', 'Tab', '', 'Para 500', '', '', '', '', '', '', '', '3'],
  ['Cream', 'B', '', 'Gel A\nGel B', '', '', '', '', '', '', '', ''],
  ['Packing', '', '', '', '', '2', '', '', '', '', '', ''],
]

test('maps day columns, steps, depts and month rollover', () => {
  const tasks = parseSheet(sheet)
  const by = Object.fromEntries(tasks.map(t => [t.sheet_ref, t]))

  assert.ok(by['2026-08-28|disp||Para 500'], 'Disp product sits in the day column')
  assert.ok(by['2026-09-01|disp||Amox (12)'], 'a week that starts the month: the 20s belong to the previous month')
  assert.equal(by['2026-09-01|disp||Amox (12)'].lot_number, '12')

  const mix = by['2026-08-28|tablets|Mix|Para 500']
  const tab = by['2026-08-28|tablets|Tab|Para 500']
  assert.ok(mix && tab, 'same product, two steps, same day = two tasks')
  assert.equal(mix.title, '[Mix] Para 500')
  assert.equal(mix.sheet_path, 'Tablets › Mix')

  const pv = by['2026-09-02|tablets|Mix|PV1 Vita C (101)']
  assert.equal(pv.type, 'pv_lot')
  assert.equal(pv.lot_number, '101')
})

test('splits multi-line cells and skips junk', () => {
  const tasks = parseSheet(sheet)
  const cream = tasks.filter(t => t.section === 'cream').map(t => t.product_name)
  assert.deepEqual(cream, ['Gel A', 'Gel B'])
  assert.ok(!tasks.some(t => t.product_name === 'Total' || t.product_name === '3'))
  assert.ok(!tasks.some(t => t.section === 'packing'), 'packing batch counts are not products')
})

test('never emits user-owned fields', () => {
  for (const t of parseSheet(sheet)) {
    for (const k of ['status', 'notes', 'priority', 'assignee']) assert.ok(!(k in t), `${k} leaked`)
  }
})

test('rows before a month header are ignored; a new month resets day columns', () => {
  const tasks = parseSheet([
    header,
    ['Tablets', 'Mix', '', 'Early'],
    ['', 'OCT/2026'],
    ['Tablets', 'Mix', '', 'NoHeaderYet'],
  ])
  assert.equal(tasks.length, 0)
})

// Real snapshots (gitignored, *.private.json = raw `values` arrays saved by
// scripts/snapshot-sheet.js) — just make sure they parse into something sane.
const fixtures = (() => { try { return readdirSync(new URL('./fixtures/', import.meta.url)) } catch { return [] } })()
for (const f of fixtures.filter(f => f.endsWith('.json'))) {
  test(`snapshot ${f} parses`, () => {
    const rows = JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))
    const tasks = parseSheet(rows)
    assert.ok(tasks.length > 0)
    assert.equal(new Set(tasks.map(t => t.sheet_ref)).size, tasks.length)
    for (const t of tasks) assert.match(t.due_date, /^\d{4}-\d{2}-\d{2}$/)
  })
}
