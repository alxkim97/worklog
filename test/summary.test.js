import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarize, doneEntry } from '../src/summary.js'

const T = '2026-11-23'
const sheet = (o) => ({ source: 'sheet', status: 'pending', type: 'production', sheet_path: 'Tablets › Mix', ...o })
const own = (o) => ({ source: 'manual', type: 'task', status: 'done', ...o })

test('plan rows count by date once passed; today and future do not', () => {
  assert.deepEqual(doneEntry(sheet({ id: 1, type: 'pv_lot', due_date: '2026-11-20' }), T), { cat: 'pv', day: '2026-11-20' })
  assert.equal(doneEntry(sheet({ id: 2, type: 'pv_lot', due_date: T }), T), null)
  // ticked done early still counts, on its plan date
  assert.deepEqual(doneEntry(sheet({ id: 3, type: 'pv_lot', due_date: '2026-11-25', status: 'done' }), T), { cat: 'pv', day: '2026-11-25' })
  assert.equal(doneEntry(sheet({ id: 4, type: 'pv_lot', due_date: '2026-11-20', status: 'deferred' }), T), null)
})

test('only PV steps and R&D-line runs count from the plan', () => {
  assert.equal(doneEntry(sheet({ id: 5, due_date: '2026-11-20' }), T), null)
  assert.equal(doneEntry(sheet({ id: 6, due_date: '2026-11-20', sheet_path: 'Liquid › R&D line › Mix' }), T).cat, 'rdline')
})

test('own tasks count on their done_at day, by type', () => {
  assert.deepEqual(doneEntry(own({ id: 7, type: 'rd_experiment', due_date: '2026-11-01', done_at: '2026-11-10T09:00:00' }), T), { cat: 'rd_experiment', day: '2026-11-10' })
  assert.equal(doneEntry(own({ id: 8, status: 'in_progress' }), T), null)
})

test('summarize groups PV steps by lot, R&D line by product, filters the range', () => {
  const tasks = [
    sheet({ id: 'a', type: 'pv_lot', product_name: 'Ramol PV1', lot_number: '101', step: 'Mix', due_date: '2026-11-03' }),
    sheet({ id: 'b', type: 'pv_lot', product_name: 'Ramol PV1', lot_number: '101', step: 'Tab', due_date: '2026-11-05' }),
    sheet({ id: 'c', type: 'pv_lot', product_name: 'Ramol PV1', lot_number: '101', step: 'Coat', due_date: '2026-10-30' }),
    sheet({ id: 'd', product_name: 'Hashi syrup', due_date: '2026-11-04', sheet_path: 'Liquid › R&D line › Mix' }),
    sheet({ id: 'e', product_name: 'Hashi syrup', due_date: '2026-11-11', sheet_path: 'Liquid › R&D line › Bottle' }),
    own({ id: 'f', type: 'document', title: 'SOP update', done_at: '2026-11-12T03:00:00' }),
    own({ id: 'f', type: 'document', title: 'SOP update', done_at: '2026-11-12T03:00:00' }), // duplicate row
  ]
  const s = summarize(tasks, '2026-11-01', '2026-11-30', T)
  assert.equal(s.counts.pv, 2)
  assert.equal(s.counts.rdline, 2)
  assert.equal(s.counts.document, 1)
  assert.equal(s.total, 5)
  assert.equal(s.pvLots.length, 1)
  assert.deepEqual(s.pvLots[0].steps.map(x => x.step), ['Mix', 'Tab'])
  assert.equal(s.rdLine[0].runs.length, 2)
  assert.deepEqual(s.byMonth, [{ month: '2026-11', pv: 2, rdline: 2, rd_experiment: 0, document: 1, task: 0, meeting: 0, pv_lot: 0 }])
})
