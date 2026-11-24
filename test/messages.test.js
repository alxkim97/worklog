import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDigest, planChangeMessage, reminderMessage, toPlain } from '../lib/messages.js'
import { flexMessage } from '../lib/lineCards.js'

const sheet = o => ({ source: 'sheet', status: 'pending', type: 'production', sheet_path: 'Tablets › Mix', section: 'tablets', ...o })
const own = o => ({ source: 'manual', type: 'task', status: 'pending', ...o })

// LINE rejects a card with any empty or non-string text.
function assertValidFlex(msg) {
  assert.equal(msg.type, 'flex')
  assert.ok(msg.altText && msg.altText.length <= 400)
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n && typeof n === 'object') {
      if ((n.type === 'text' && !n.contents) || n.type === 'span') assert.ok(typeof n.text === 'string' && n.text.length > 0, `empty text in ${JSON.stringify(n)}`)
      Object.values(n).forEach(walk)
    }
  }
  walk(msg.contents)
  assert.ok(JSON.stringify(msg).length < 28000)
}

const TUE = '2026-11-24', MON = '2026-11-23', SAT = '2026-11-28'
const tasks = [
  sheet({ id: 1, type: 'pv_lot', product_name: 'BANOCINORAL 50x1g (04) PV1', lot_number: '101', step: 'Mix', due_date: TUE }),
  sheet({ id: 2, type: 'pv_lot', product_name: 'Procoxib 120 PV2', step: 'Tab', due_date: TUE }),
  sheet({ id: 3, product_name: 'Hashi syrup 60 mL', step: 'Bottle', due_date: TUE, sheet_path: 'Liquid › R&D line › Bottle' }),
  sheet({ id: 4, product_name: 'Ramol 500', step: 'Mix', due_date: TUE }), // plain production: not R&D
  own({ id: 5, title: 'Order HPLC columns', due_date: TUE }),
  own({ id: 6, title: 'R&D weekly sync', type: 'meeting', due_date: TUE }),
  own({ id: 7, title: 'Send COA request', due_date: '2026-11-21' }),
  own({ id: 8, title: 'Done thing', status: 'done', due_date: TUE }),
  sheet({ id: 9, type: 'pv_lot', product_name: 'Machto Gel PV1', step: 'Coat', due_date: '2026-11-26' }),
]

test('weekday digest: R&D only, clash, overdue', () => {
  const m = buildDigest(tasks, TUE)
  assert.equal(m.title, 'Today · Tue 24 Nov')
  const labels = m.sections.map(s => s.label)
  assert.deepEqual(labels, ['PV steps', 'R&D line', 'Your tasks', 'Meetings', '⚠ Clash', 'Overdue'])
  assert.equal(m.sections[0].rows.length, 2)
  assert.ok(!JSON.stringify(m).includes('Ramol'))
  assert.ok(!JSON.stringify(m).includes('Done thing'))
  assert.match(m.subtitle, /2 PV steps · 1 R&D-line run · 1 task · 1 meeting/)
  assertValidFlex(flexMessage(m))
})

test('Monday adds the week ahead', () => {
  const m = buildDigest(tasks, MON)
  const week = m.sections.find(s => s.label === 'Week ahead')
  assert.ok(week)
  assert.equal(week.rows[0].bold, 'Tue 24 Nov')
  assert.match(week.rows[0].sub, /⚠ Clash/)
  assert.match(week.rows[0].sub, /PV  BANOCINORAL 50x1g · Mix/)
  assert.equal(week.rows[1].bold, 'Thu 26 Nov')
  assertValidFlex(flexMessage(m))
})

test('weekend: friendly note, or nothing when switched off', () => {
  const m = buildDigest(tasks, SAT)
  assert.equal(m.note, 'Nothing planned for R&D today.')
  assert.ok(m.title.length > 3)
  assertValidFlex(flexMessage(m))
  assert.equal(buildDigest(tasks, SAT, { weekend: false }), null)
  // the wording varies from day to day
  assert.notEqual(buildDigest(tasks, SAT).title, buildDigest(tasks, '2026-11-29').title)
})

test('plan changes: grouped by product, far ones folded into one line', () => {
  const ch = [
    { kind: 'added', name: 'BANOCINORAL 50x1g (04) PV1', step: 'Fill Liquid', lot: '04', to: '2026-12-04' },
    { kind: 'added', name: 'BANOCINORAL 50x1g (04) PV1', step: 'Fill Liquid', lot: '04', to: '2026-12-08' },
    { kind: 'moved', name: 'Procoxib 120 PV2', step: 'Tab', from: '2026-11-25', to: '2026-11-27' },
    { kind: 'removed', name: 'Polycin PV2', step: 'Fill Cream', from: '2026-11-28' },
    { kind: 'added', name: 'Procoxib 120 PV2', step: 'Coat', to: '2026-12-18' },
  ]
  const m = planChangeMessage(ch, TUE)
  assert.equal(m.sections.length, 3)
  assert.equal(m.sections[0].title, 'Procoxib 120 PV2') // soonest first
  assert.match(m.note, /\+1 more change after Tue 8 Dec/)
  assert.match(m.subtitle, /4 R&D steps · next 14 days/)
  assertValidFlex(flexMessage(m))
  const p = toPlain(m)
  assert.match(p.body, /Fill Liquid Fri 4 Dec new/)
  assert.equal(m.sections[0].rows[0].tag, 'moved')
  // only far changes
  const far = planChangeMessage([ch[4]], TUE)
  assert.equal(far.sections.length, 0)
  assertValidFlex(flexMessage(far))
})

test('reminder card', () => {
  const m = reminderMessage([{ title: 'PV tomorrow: Machto Gel PV1', body: 'Coat · Tablets · Lot 114' }])
  assertValidFlex(flexMessage(m))
})
