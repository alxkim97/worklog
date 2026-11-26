import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseArgs, checkPatch, checkNew, parseRemind, remindText, tickPatch, changedFields, undoOf, matchId,
  fmtTask, dayLines, parseJsonArg, fmtChanges,
} from '../lib/cli.js'
import { pvLots, searchTasks, autoDone } from '../lib/rd.js'
import { today, addDays } from '../src/dates.js'

const t0 = today()
const own = (extra = {}) => ({ id: 'aaaa1111-0000-0000-0000-000000000001', source: 'manual', title: 'Write PV report', type: 'task', status: 'pending', priority: 'normal', due_date: t0, ...extra })
const pv = (extra = {}) => ({ id: 'bbbb2222-0000-0000-0000-000000000002', source: 'sheet', type: 'pv_lot', status: 'pending', product_name: 'PROCOXIB 90 PV2', lot_number: '02', step: 'Coat', section: 'tablets', due_date: t0, ...extra })

// ── parsing ──
test('parseArgs splits command, positionals and flags', () => {
  const a = parseArgs(['edit', 'aaaa1111', '{"notes":"x"}', '--apply'])
  assert.equal(a.cmd, 'edit')
  assert.deepEqual(a.pos, ['aaaa1111', '{"notes":"x"}'])
  assert.deepEqual(a.flags, { apply: true })
  assert.deepEqual(parseArgs(['list', '--from', '2026-11-01', '--to=2026-11-30', '--json']).flags, { from: '2026-11-01', to: '2026-11-30', json: true })
  assert.equal(parseArgs([]).cmd, 'help')
})

test('parseArgs: a value flag with no value is an error, a bool flag never eats the next word', () => {
  assert.throws(() => parseArgs(['list', '--from']), /--from needs a value/)
  assert.deepEqual(parseArgs(['tick', '--untick', 'bbbb', '2']).pos, ['bbbb', '2'])
})

test('parseJsonArg wants an object', () => {
  assert.deepEqual(parseJsonArg('{"a":1}'), { a: 1 })
  assert.throws(() => parseJsonArg('[1]'), /object/)
  assert.throws(() => parseJsonArg('{bad'), /Invalid JSON/)
})

// ── what may change ──
test('sheet rows: only status, notes, remind_days, checklist', () => {
  assert.deepEqual(checkPatch(pv(), { status: 'done', notes: 'ok' }), { status: 'done', notes: 'ok' })
  assert.throws(() => checkPatch(pv(), { due_date: '2026-12-01' }), /sync owns due_date/)
  assert.throws(() => checkPatch(pv(), { product_name: 'X', notes: 'y' }), /sync owns product_name/)
})

test('own tasks: app-editable fields, with values checked', () => {
  assert.deepEqual(checkPatch(own(), { due_date: '2026-12-01', priority: 'high' }), { due_date: '2026-12-01', priority: 'high' })
  assert.throws(() => checkPatch(own(), { source: 'sheet' }), /read-only/)
  assert.throws(() => checkPatch(own(), { status: 'finished' }), /status must be/)
  assert.throws(() => checkPatch(own(), { due_date: '1/12/2026' }), /YYYY-MM-DD/)
  assert.throws(() => checkPatch(own(), {}), /Nothing to change/)
})

test('checkNew fills app defaults and refuses unknown fields', () => {
  const r = checkNew({ title: '  Call QC  ', due_date: '2026-12-02' })
  assert.deepEqual(r, { type: 'task', status: 'pending', priority: 'normal', title: 'Call QC', due_date: '2026-12-02', start_date: '2026-12-02' })
  assert.throws(() => checkNew({ due_date: '2026-12-02' }), /title is required/)
  assert.throws(() => checkNew({ title: 'x', source: 'sheet' }), /Unknown field/)
  assert.throws(() => checkNew({ title: 'x', start_date: '2026-12-05', due_date: '2026-12-02' }), /after due_date/)
})

test('remind words', () => {
  assert.equal(parseRemind('off'), -1)
  assert.equal(parseRemind('default'), null)
  assert.equal(parseRemind('3'), 3)
  assert.throws(() => parseRemind('soon'), /remind takes/)
  assert.equal(remindText(0), 'on the day')
  assert.equal(remindText(-1), 'off')
})

// ── checklist ──
test('tick copies the step default the first time, then toggles one item', () => {
  const p = tickPatch(pv(), 2)
  assert.equal(p.checklist.length, 4)
  assert.deepEqual(p.checklist.map(i => i.done), [false, true, false, false])
  const again = tickPatch(pv({ checklist: p.checklist }), 2, false)
  assert.ok(again.checklist.every(i => !i.done))
  assert.throws(() => tickPatch(pv(), 9), /Item must be 1-4/)
  assert.throws(() => tickPatch(own(), 1), /Only PV steps/)
})

// ── log + undo ──
test('changedFields lists only real changes', () => {
  assert.deepEqual(changedFields({ status: 'pending', notes: null }, { status: 'done', notes: null }), [{ field: 'status', from: 'pending', to: 'done' }])
})

test('undoOf reverses update, insert and delete', () => {
  assert.deepEqual(undoOf({ op: 'update', table: 'work_tasks', id: 'x', before: { status: 'pending', notes: null }, after: { status: 'done', notes: 'n' } }),
    { op: 'update', table: 'work_tasks', id: 'x', patch: { status: 'pending', notes: null } })
  assert.deepEqual(undoOf({ op: 'insert', table: 't', id: 'x', after: {} }), { op: 'delete', table: 't', id: 'x' })
  assert.deepEqual(undoOf({ op: 'delete', table: 't', id: 'x', before: { id: 'x', title: 'a' } }), { op: 'insert', table: 't', id: 'x', row: { id: 'x', title: 'a' } })
})

test('matchId resolves short ids and refuses ambiguous ones', () => {
  const rows = [own(), pv(), own({ id: 'aaaa1199-0000' })]
  assert.equal(matchId(rows, 'bbbb2222').id, pv().id)
  assert.equal(matchId(rows, 'cccc'), null)
  assert.throws(() => matchId(rows, 'aaaa11'), /matches 2 rows/)
  assert.throws(() => matchId(rows, 'aa'), /at least 4/)
})

// ── output ──
test('fmtTask shows status, name, step, checklist and the short id', () => {
  const line = fmtTask(pv({ checklist: [{ t: 'a', done: true }, { t: 'b', done: false }] }))
  assert.match(line, /^\[ \] .* PROCOXIB 90 PV2 · Coat .*checklist 1\/2 .*#bbbb2222$/)
  assert.match(fmtTask(own({ notes: 'line 1\nline 2', priority: 'high' })), /Write PV report {2}high {2}— line 1 line 2 {2}#aaaa1111/)
})

test('dayLines groups a day like the digest and shows clashes + notes', () => {
  const tasks = [pv(), pv({ id: 'cccc3333', step: 'Blister', product_name: 'LEBREX 200 PV1' }), own()]
  const out = dayLines(tasks, [{ id: 'dddd4444', note_date: t0, content: 'QC audit' }], t0).join('\n')
  assert.match(out, /PV steps\n.*PROCOXIB.*\n.*LEBREX/)
  assert.match(out, /My tasks\n.*Write PV report/)
  assert.match(out, /! Clash: 2 PV steps/)
  assert.match(out, /Notes\n.*QC audit/)
})

// ── shared selectors moved to lib/rd.js ──
test('pvLots groups by product + lot, active first', () => {
  const lots = pvLots([pv({ due_date: addDays(t0, -30), id: '1' }), pv({ step: 'Blister', due_date: addDays(t0, 2), id: '2' }),
    pv({ product_name: 'OLD PV1', lot_number: '01', due_date: addDays(t0, -40), id: '3' })], t0)
  assert.deepEqual(lots.map(l => [l.name, l.steps.length]), [['PROCOXIB 90 PV2', 2], ['OLD PV1', 1]])
})

test('searchTasks and autoDone', () => {
  assert.equal(searchTasks([own(), pv()], 'procoxib').length, 1)
  assert.equal(searchTasks([own()], '  ').length, 0)
  assert.equal(autoDone(pv({ due_date: addDays(t0, -1) }), t0).status, 'done')
  assert.equal(autoDone(own({ due_date: addDays(t0, -1) }), t0).status, 'pending')
})

test('checklist changes print as counts + the flipped item', () => {
  const after = tickPatch(pv(), 1).checklist
  const out = fmtChanges(changedFields({ checklist: null }, { checklist: after }))
  assert.match(out, /checklist: not started → 1\/4\n {4}ticked 1\. /)
})
