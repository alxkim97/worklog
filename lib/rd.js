// What counts as R&D's business, shared by the app (src/) and the server
// (api/digest). Pure functions over work_tasks rows; no state, no DOM.
import { STEPS } from './depts.js'

export const isSheet = t => t.source === 'sheet'
export const isOwn = t => t.source === 'manual'
export const isPvStep = t => isSheet(t) && t.type === 'pv_lot'
// Runs on the sheet's 'RD' machine line — production, but R&D's business.
export const isRdLine = t => isSheet(t) && (t.sheet_path || '').includes('R&D line')
export const isOpen = t => t.status === 'pending' || t.status === 'in_progress'
export const startOf = t => (t.start_date && t.due_date && t.start_date < t.due_date ? t.start_date : t.due_date)
export const onDay = (t, d) => !!t.due_date && startOf(t) <= d && d <= t.due_date
// Sheet names can carry a Thai prefix ('prepare coating solution …'): drop it.
export const nameOf = t => (isSheet(t) ? (t.product_name || t.title || '').replace(/^[^A-Za-z0-9]+/, '').trim() : (t.title || '').trim())

const live = t => !t.sheet_removed_at
const short = t => `${nameOf(t)}${t.step ? ` (${t.step})` : ''}`

// Clashes on day d: R&D needed in two places at once.
//   • two or more PV steps from the plan
//   • a PV step and an R&D-line run
export function clashesOn(tasks, d) {
  const on = tasks.filter(t => live(t) && t.due_date && onDay(t, d))
  const pv = on.filter(t => isPvStep(t) && t.status !== 'deferred')
  const rd = on.filter(t => isRdLine(t) && !isPvStep(t))
  const out = []
  if (pv.length >= 2) out.push({ kind: 'pv-pv', tasks: pv, text: `${pv.length} PV steps: ${pv.map(short).join(', ')}` })
  if (pv.length && rd.length) out.push({ kind: 'pv-rd', tasks: [...pv, ...rd], text: `PV ${pv.map(short).join(', ')} + R&D line ${rd.map(short).join(', ')}` })
  return out
}

// R&D items on day d, split the way the digest shows them.
export function rdDay(tasks, d) {
  const on = tasks.filter(t => live(t) && onDay(t, d))
  const own = on.filter(t => isOwn(t) && isOpen(t))
  return {
    pv: on.filter(t => isPvStep(t) && t.status !== 'deferred'),
    rdLine: on.filter(t => isRdLine(t) && !isPvStep(t)),
    tasks: own.filter(t => t.type !== 'meeting'),
    meetings: own.filter(t => t.type === 'meeting'),
    clashes: clashesOn(tasks, d),
  }
}

// Production-plan steps whose date has passed happened as planned — nobody
// ticks them off. Show them as done (display only; the row isn't changed)
// unless a status was set by hand.
export const autoDone = (r, today) => (r.source === 'sheet' && r.status === 'pending' && r.due_date && r.due_date < today
  ? { ...r, status: 'done', auto_done: true } : r)

const stepRank = s => { const i = STEPS.indexOf(s); return i === -1 ? -1 : i }

// PV lots: sheet pv_lot rows grouped into one card per product + lot.
// Active/upcoming first (by next date), finished ones after.
export function pvLots(tasks, today) {
  const lots = new Map()
  for (const t of tasks) {
    if (t.type !== 'pv_lot' || !isSheet(t)) continue
    // Steps can carry a Thai prefix (e.g. 'prepare coating solution …') — group on the product itself.
    const name = nameOf(t)
    const key = `${name}|${t.lot_number || ''}`
    if (!lots.has(key)) lots.set(key, { key, name, lot: t.lot_number, steps: [] })
    lots.get(key).steps.push(t)
  }
  const out = [...lots.values()].map(l => {
    l.steps.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '') || stepRank(a.step) - stepRank(b.step))
    l.first = l.steps[0]?.due_date
    l.last = l.steps[l.steps.length - 1]?.due_date
    l.done = l.steps.filter(s => s.status === 'done').length
    return l
  })
  return out.sort((a, b) => ((a.last < today) - (b.last < today)) || (a.last < today ? b.last.localeCompare(a.last) : a.first.localeCompare(b.first)))
}

// Text search over title, product, lot, notes and sheet path; newest first.
export function searchTasks(tasks, q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return []
  return tasks.filter(t => [t.title, t.product_name, t.lot_number, t.notes, t.sheet_path]
    .some(v => v && String(v).toLowerCase().includes(s)))
    .sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''))
    .slice(0, 200)
}
