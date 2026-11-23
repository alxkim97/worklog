// Clash warnings: days where R&D is needed in two places at once.
//   • two or more PV steps from the plan on the same day
//   • a PV step and an R&D-line run on the same day
// Only today onward (a past clash is history). Uses every plan row, whatever
// the production layer shows, so hiding production never hides a clash.
import { state, onDay, isSheet, isRdLine } from './store.js'
import { today, addDays } from './dates.js'

const isPvStep = t => isSheet(t) && t.type === 'pv_lot' && t.status !== 'deferred'
const nameOf = t => (t.product_name || t.title || '').replace(/^[^A-Za-z0-9]+/, '').trim()
const short = t => `${nameOf(t)}${t.step ? ` (${t.step})` : ''}`

export function dayClashes(d) {
  if (!d || d < today()) return []
  const on = state.tasks.filter(t => t.due_date && onDay(t, d))
  const pv = on.filter(isPvStep)
  const rd = on.filter(t => isRdLine(t) && t.type !== 'pv_lot')
  const out = []
  if (pv.length >= 2) out.push({ kind: 'pv-pv', tasks: pv, text: `${pv.length} PV steps: ${pv.map(short).join(', ')}` })
  if (pv.length && rd.length) out.push({ kind: 'pv-rd', tasks: [...pv, ...rd], text: `PV ${pv.map(short).join(', ')} + R&D line ${rd.map(short).join(', ')}` })
  return out
}

export const clashTitle = d => dayClashes(d).map(c => c.text).join('\n')

// The next `days` days that have a clash, soonest first.
export function upcomingClashes(days = 14) {
  const t = today()
  const out = []
  for (let i = 0; i <= days; i++) {
    const d = addDays(t, i)
    const c = dayClashes(d)
    if (c.length) out.push({ d, clashes: c })
  }
  return out
}
