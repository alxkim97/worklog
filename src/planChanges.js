// Plan-change alerts: after each load, compare the new plan with the one you
// last saw (the cached copy) and report what moved for PV steps and R&D-line
// runs. The sheet has no stable row id (a row's key includes its date), so a
// step is matched on product + lot + step + department instead.
import { state, isSheet, isRdLine } from './store.js'
import { today, weekday, shortDate } from './dates.js'
import { notify } from './reminders.js'
import { planChangeMessage, toPlain } from '../lib/messages.js'
import { lineChanges } from './line.js'

const LOG_KEY = 'wl_plan_changes'
const KEEP_DAYS = 14

const watched = t => isSheet(t) && (t.type === 'pv_lot' || isRdLine(t)) && !!t.due_date
const nameOf = t => (t.product_name || t.title || '').replace(/^[^A-Za-z0-9]+/, '').trim()
const keyOf = t => [nameOf(t).toLowerCase(), t.lot_number || '', t.step || '', t.section || ''].join('|')

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
  const entry = (kind, task, extra) => ({ kind, name: nameOf(task), step: task.step || null, lot: task.lot_number || null, pv: task.type === 'pv_lot', ...extra })
  for (const [k, olds] of a) {
    const news = b.get(k) || []
    for (let i = 0; i < Math.max(olds.length, news.length); i++) {
      const o = olds[i], n = news[i]
      if (o && n && o.due_date !== n.due_date) out.push(entry('moved', n, { from: o.due_date, to: n.due_date, id: n.id }))
      else if (o && !n) out.push(entry('removed', o, { from: o.due_date }))
      else if (!o && n) out.push(entry('added', n, { to: n.due_date, id: n.id }))
    }
  }
  for (const [k, news] of b) if (!a.has(k)) news.forEach(n => out.push(entry('added', n, { to: n.due_date, id: n.id })))
  return out
}

const day = d => `${weekday(d)} ${shortDate(d)}`
export function changeText(c) {
  const what = `${c.name}${c.step ? ` · ${c.step}` : ''}`
  if (c.kind === 'moved') return { what, how: `${day(c.from)} → ${day(c.to)}` }
  if (c.kind === 'removed') return { what, how: `removed (was ${day(c.from)})` }
  return { what, how: `new on ${day(c.to)}` }
}

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
