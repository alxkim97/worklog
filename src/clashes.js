// Clash warnings in the app (the rule itself lives in lib/rd.js, shared with
// the server's daily digest). Only today onward (a past clash is history).
// Uses every plan row, whatever the production layer shows, so hiding
// production never hides a clash.
import { state } from './store.js'
import { today, addDays } from './dates.js'
import { clashesOn } from '../lib/rd.js'

export const dayClashes = d => (!d || d < today() ? [] : clashesOn(state.tasks, d))

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
