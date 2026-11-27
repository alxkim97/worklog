import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carryOver, hasUserData } from '../lib/planDiff.js'

let n = 0
const row = (step, due, extra = {}) => ({ id: `r${++n}`, sheet_ref: `${due}|tablets|${step}||X PV1 ${n}`, source: 'sheet', type: 'pv_lot', product_name: 'BANOCINORAL 50x1g (04) PV1', lot_number: '04', section: 'tablets', step, due_date: due, status: 'pending', ...extra })

test('a moved PV step hands its checklist, notes, reminder and status to the new row', () => {
  const old = row('Mix', '2026-12-01', { notes: 'BU samples to QC', checklist: [{ t: 'LOD', done: true }], remind_days: 1, status: 'in_progress' })
  const moved = row('Mix', '2026-12-02')
  const pairs = carryOver([old], [moved])
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].from, old)
  assert.equal(pairs[0].to, moved)
})

test('rows you never touched carry nothing', () => {
  assert.deepEqual(carryOver([row('Mix', '2026-12-01')], [row('Mix', '2026-12-02')]), [])
  assert.equal(hasUserData({ status: 'pending', notes: null, checklist: null, remind_days: null }), false)
  assert.equal(hasUserData({ status: 'pending', checklist: [] }), false)
})

test('a note added to the name still matches (…PV1/Cal เครื่องชั่ง)', () => {
  const old = row('Tab', '2026-12-03', { notes: 'x' })
  const renamed = row('Tab', '2026-12-03', { product_name: 'BANOCINORAL 50x1g (04) PV1/Cal เครื่องชั่ง' })
  assert.equal(carryOver([old], [renamed]).length, 1)
})

test('only the same step, lot and department match; nearest date wins', () => {
  const old = row('Coat', '2026-12-05', { notes: 'spray rate' })
  const otherStep = row('Tab', '2026-12-05')
  const otherLot = row('Coat', '2026-12-05', { lot_number: '05' })
  const far = row('Coat', '2026-12-20')
  const near = row('Coat', '2026-12-06')
  const pairs = carryOver([old], [otherStep, otherLot, far, near])
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].to, near)
})

test('two moved steps of the same key pair one-to-one', () => {
  const a = row('Mix', '2026-12-01', { notes: 'a' })
  const b = row('Mix', '2026-12-08', { notes: 'b' })
  const a2 = row('Mix', '2026-12-02')
  const b2 = row('Mix', '2026-12-09')
  const pairs = carryOver([b, a], [b2, a2])
  assert.deepEqual(pairs.map(p => [p.from.notes, p.to.due_date]), [['a', '2026-12-02'], ['b', '2026-12-09']])
})
