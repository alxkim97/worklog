// Plan-change diff, shared by the app (src/planChanges.js) and the CLI
// (scripts/worklog-claude.js). Pure: compares two lists of work_tasks rows.
// The sheet has no stable row id (a row's key includes its date), so a step
// is matched on product + lot + step + department instead.
import { today, weekday, shortDate } from '../src/dates.js'
import { isSheet, isRdLine } from './rd.js'

const watched = t => isSheet(t) && (t.type === 'pv_lot' || isRdLine(t)) && !!t.due_date
const fullName = t => (t.product_name || t.title || '').replace(/^[^A-Za-z0-9]+/, '').trim()
// The sheet sometimes gets a note added to a name ("…PV2/Cal เครื่องชั่ง",
// balance calibration that day). Match on the name before the note, so a
// note never reads as the step being removed and a new one added.
const THAI = /[฀-๿]+/g
const baseName = t => fullName(t).split('/')[0].replace(THAI, '').replace(/\s+/g, ' ').trim()
const noteOf = t => {
  const n = fullName(t)
  const rest = n.includes('/') ? n.slice(n.indexOf('/') + 1) : (n.match(THAI) || []).join(' ')
  return rest.replace(/\s+/g, ' ').trim()
}
const keyOf = t => [baseName(t).toLowerCase(), t.lot_number || '', t.step || '', t.section || ''].join('|')

function index(tasks, from) {
  const m = new Map()
  for (const t of tasks) {
    if (!watched(t) || t.due_date < from) continue
    const k = keyOf(t)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(t)
  }
  for (const list of m.values()) list.sort((a, b) => a.due_date.localeCompare(b.due_date))
  return m
}

// Upcoming changes only: anything already in the past is history, not news.
export function diffPlan(prev, next) {
  const t = today()
  const a = index(prev, t)
  const b = index(next, t)
  const out = []
  const entry = (kind, task, extra) => ({ kind, name: baseName(task), step: task.step || null, lot: task.lot_number || null, pv: task.type === 'pv_lot', ...extra })
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const olds = [...(a.get(k) || [])]
    const news = [...(b.get(k) || [])]
    // 1. Same date on both sides: not news — unless its note changed.
    for (let i = olds.length - 1; i >= 0; i--) {
      const j = news.findIndex(n => n.due_date === olds[i].due_date)
      if (j === -1) continue
      const [o] = olds.splice(i, 1)
      const [n] = news.splice(j, 1)
      if (noteOf(o) !== noteOf(n)) out.push(entry('note', n, { to: n.due_date, note: noteOf(n) || null, was: noteOf(o) || null, id: n.id }))
    }
    // 2. What's left pairs up in date order as moves; the rest is new or gone.
    olds.sort((x, y) => x.due_date.localeCompare(y.due_date))
    news.sort((x, y) => x.due_date.localeCompare(y.due_date))
    for (let i = 0; i < Math.max(olds.length, news.length); i++) {
      const o = olds[i], n = news[i]
      if (o && n) out.push(entry('moved', n, { from: o.due_date, to: n.due_date, id: n.id }))
      else if (o) out.push(entry('removed', o, { from: o.due_date }))
      else out.push(entry('added', n, { to: n.due_date, id: n.id }))
    }
  }
  return out
}

const day = d => `${weekday(d)} ${shortDate(d)}`
export function changeText(c) {
  const what = `${c.name}${c.step ? ` · ${c.step}` : ''}`
  if (c.kind === 'moved') return { what, how: `${day(c.from)} → ${day(c.to)}` }
  if (c.kind === 'removed') return { what, how: `removed (was ${day(c.from)})` }
  if (c.kind === 'note') return { what, how: c.note ? `${day(c.to)} · note: ${c.note}` : `${day(c.to)} · note removed` }
  return { what, how: `new on ${day(c.to)}` }
}
