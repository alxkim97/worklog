// What counts as R&D's business, shared by the app (src/) and the server
// (api/digest). Pure functions over work_tasks rows; no state, no DOM.

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
