import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffPlan } from '../src/planChanges.js'
import { today, addDays } from '../src/dates.js'

const t0 = today()
const d = n => addDays(t0, n)
let n = 0
const pv = (step, due, extra = {}) => ({ id: `r${++n}`, source: 'sheet', type: 'pv_lot', product_name: 'BANOCINORAL 50×1g (04) PV1', lot_number: '04', section: 'tablets', step, due_date: due, ...extra })
const prod = (due, path) => ({ id: `r${++n}`, source: 'sheet', type: 'production', product_name: 'Hashi syrup', section: 'liquid', step: 'Mix', due_date: due, sheet_path: path })

test('a PV step that changes date is reported as moved', () => {
  const out = diffPlan([pv('Mix', d(1)), pv('Tab', d(2))], [pv('Mix', d(1)), pv('Tab', d(4))])
  assert.equal(out.length, 1)
  assert.deepEqual([out[0].kind, out[0].step, out[0].from, out[0].to], ['moved', 'Tab', d(2), d(4)])
})

test('removed and newly planned steps are reported', () => {
  const out = diffPlan([pv('Coat', d(3))], [pv('Blister', d(5))])
  assert.deepEqual(out.map(c => c.kind).sort(), ['added', 'removed'])
})

test('past dates and unchanged plans are quiet', () => {
  assert.equal(diffPlan([pv('Mix', d(-2))], [pv('Mix', d(-1))]).length, 0)
  assert.equal(diffPlan([pv('Mix', d(1))], [pv('Mix', d(1))]).length, 0)
})

test('only PV steps and R&D-line runs are watched', () => {
  assert.equal(diffPlan([prod(d(1), 'Liquid › Mix')], [prod(d(3), 'Liquid › Mix')]).length, 0)
  const out = diffPlan([prod(d(1), 'Liquid › R&D line › Mix')], [prod(d(3), 'Liquid › R&D line › Mix')])
  assert.equal(out[0]?.kind, 'moved')
})
