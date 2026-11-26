// Plan-change alerts: after each load, compare the new plan with the one you
// last saw (the cached copy) and report what moved for PV steps and R&D-line
// runs. The diff itself lives in lib/planDiff.js (shared with the CLI).
import { state } from './store.js'
import { today } from './dates.js'
import { notify } from './reminders.js'
import { planChangeMessage, toPlain } from '../lib/messages.js'
import { lineChanges } from './line.js'
import { diffPlan, changeText } from '../lib/planDiff.js'
export { diffPlan, changeText }

const LOG_KEY = 'wl_plan_changes'
const KEEP_DAYS = 14

// ── Log (shown on Today until cleared) ──
export function loadChanges() {
  try {
    const cutoff = Date.now() - KEEP_DAYS * 86400000
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]').filter(c => new Date(c.at) > cutoff)
  } catch { return [] }
}
export function clearChanges() { try { localStorage.removeItem(LOG_KEY) } catch {} }

export function recordPlanChanges(changes) {
  if (!changes.length) return
  const at = new Date().toISOString()
  const log = [...changes.map(c => ({ ...c, at })), ...loadChanges()].slice(0, 60)
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)) } catch {}
  if (state.prefs.changeAlerts === false) return
  // Grouped by product, the next 14 days listed and later ones as one line:
  // a Windows pop-up (plain text) and, if switched on, a LINE card.
  const { title, body } = toPlain(planChangeMessage(changes, today()))
  notify({ title, body, tag: `plan-${at}`, line: false })
  lineChanges(changes)
}
