import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupChanges, dateRange, splitPv } from '../lib/changeGroups.js'

const PROC = "Procoxib 120 3x10's (02) PV2"
const mv = (name, lot, step, from, to, id) => ({ kind: 'moved', name, lot, step, from, to, id })

test('date ranges: one day, same month, across months', () => {
  assert.equal(dateRange(['2026-11-24']), '24 Nov')
  assert.equal(dateRange(['2026-11-30', '2026-11-24', '2026-11-27']), '24–30 Nov')
  assert.equal(dateRange(['2026-12-04', '2026-11-28']), '28 Nov–4 Dec')
})

test('one line per product + lot, with the median shift and both ranges', () => {
  const gs = groupChanges([
    mv(PROC, '02', 'Tab', '2026-12-16', '2027-01-13', 'a'),
    mv(PROC, '02', 'Tab', '2026-12-17', '2027-01-14', 'b'),
    mv(PROC, '02', 'Coat', '2026-12-18', '2027-01-15', 'c'),
    mv(PROC, '02', 'Blister', '2026-12-21', '2027-01-18', 'd'),
    mv(PROC, '02', 'Blister', '2026-12-22', '2027-01-19', 'e'),
    mv("Lebrex 200 10x10's (03) PV2", '03', 'Blister', '2026-12-14', '2026-12-16', 'f'),
  ])
  assert.equal(gs.length, 2)
  assert.equal(gs[0].title, "Lebrex 200 10x10's (03)")
  assert.equal(gs[0].text, 'Blister pushed 2 days · 14 Dec → 16 Dec')
  assert.equal(gs[1].pv, 'PV2')
  assert.equal(gs[1].lotShown, null) // already in the name as (02)
  assert.equal(gs[1].text, '5 steps pushed ~4 weeks · 16–22 Dec → 13–19 Jan')
  assert.deepEqual(gs[1].ids, ['a', 'b', 'c', 'd', 'e'])
})

test('new steps and pulled-in steps', () => {
  const [g] = groupChanges([
    mv('Machto Gel PET 240mL PV1', '114', 'Mix', '2026-11-30', '2026-11-27', 'x'),
    { kind: 'added', name: 'Machto Gel PET 240mL PV1', lot: '114', step: 'Bottle', to: '2026-12-02', id: 'y' },
  ])
  assert.equal(g.lotShown, '114')
  assert.equal(g.text, 'Mix pulled in 3 days · 30 Nov → 27 Nov · Bottle new on 2 Dec')
  assert.equal(g.firstTo, '2026-11-27')
})

test('PV tag comes off the name', () => {
  assert.deepEqual(splitPv('BANOCINORAL 50×1g (04) PV1'), { title: 'BANOCINORAL 50×1g (04)', pv: 'PV1' })
  assert.deepEqual(splitPv('Hashi syrup'), { title: 'Hashi syrup', pv: null })
})
