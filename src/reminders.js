// Reminders: a task's remind_days (0 = on the day, n = n days before it
// starts, -1 = explicitly off, null = default). PV lots fall back to the
// pvRemind preference so every PV step gets a heads-up without setting each
// one. They fire as system notifications at prefs.remindTime from whichever
// window is the main app (the desktop app sits in the tray all day).
import { state, isOpen, startOf } from './store.js'
import { today, addDays, fromStr, relDay, toStr, shortDate } from './dates.js'
import { deptLabel } from './components.js'
import { playChime } from './sound.js'
import { queueLine } from './line.js'

export const REMIND_OPTIONS = [
  { key: 'off', days: -1, label: 'Off' },
  { key: '0', days: 0, label: 'On the day' },
  { key: '1', days: 1, label: '1 day before' },
  { key: '2', days: 2, label: '2 days before' },
  { key: '3', days: 3, label: '3 days before' },
  { key: '7', days: 7, label: '1 week before' },
]
export const remindLabel = days => REMIND_OPTIONS.find(o => o.days === days)?.label || `${days} days before`

// { days, auto } or null.
export function reminderFor(t) {
  if (!t?.due_date || !isOpen(t)) return null
  if (t.remind_days != null) return t.remind_days < 0 ? null : { days: t.remind_days, auto: false }
  if (t.type === 'pv_lot' && state.prefs.pvRemind != null) return { days: state.prefs.pvRemind, auto: true }
  return null
}

export function fireAt(t, r = reminderFor(t)) {
  if (!r) return null
  const d = fromStr(addDays(startOf(t), -r.days))
  const [h, m] = (state.prefs.remindTime || '08:30').split(':').map(Number)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

const name = t => (t.source === 'sheet' ? (t.product_name || t.title) : t.title)

// Reminders whose task hasn't started yet, soonest first.
export function upcomingReminders(days = 14) {
  const t = today()
  const until = addDays(t, days)
  return state.tasks
    .map(task => ({ task, r: reminderFor(task) }))
    .filter(({ task, r }) => r && startOf(task) >= t && startOf(task) <= until)
    .map(x => ({ ...x, at: fireAt(x.task, x.r) }))
    .sort((a, b) => a.at - b.at || name(a.task).localeCompare(name(b.task)))
}

// "Today 08:30", "Tomorrow 08:30", "Thu 08:30"
export function whenLabel(at) {
  const day = toStr(at)
  const time = at.toTimeString().slice(0, 5)
  if (day < today()) return `Sent ${day === addDays(today(), -1) ? 'yesterday' : shortDate(day)}`
  return `${relDay(day)} ${time}`
}

function notificationText(t) {
  const start = startOf(t)
  const when = relDay(start)
  const kind = t.type === 'pv_lot' ? 'PV' : 'R&D'
  const step = t.step ? `${t.step} · ` : ''
  return {
    title: `${kind} ${when === 'Today' || when === 'Tomorrow' ? when.toLowerCase() : `on ${when}`}: ${name(t)}`,
    body: `${step}${t.source === 'sheet' ? deptLabel(t.section) : 'Your task'}${t.lot_number ? ` · Lot ${t.lot_number}` : ''}`,
  }
}

// ── Firing ──
const FIRED_KEY = 'wl_reminded'
function loadFired() { try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}') } catch { return {} } }
function saveFired(f) {
  // forget anything older than two weeks
  const cutoff = addDays(today(), -14)
  for (const k of Object.keys(f)) if (f[k] < cutoff) delete f[k]
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(f)) } catch {}
}

export const canNotify = () => typeof Notification !== 'undefined'
export async function askPermission() {
  if (!canNotify() || Notification.permission !== 'default') return canNotify() && Notification.permission === 'granted'
  return (await Notification.requestPermission()) === 'granted'
}

// Reminders and plan changes: a system notification + chime here, and (if
// switched on, desktop app only) the same text to LINE — even when Windows
// notifications are blocked. line: false for the Settings test.
export function notify({ title, body, tag, line = true }, onClick) {
  if (line) queueLine(title, body)
  if (!canNotify() || Notification.permission !== 'granted') return false
  const n = new Notification(title, { body, tag, icon: './icon-192.png' })
  n.onclick = () => { window.focus(); window.electronAPI?.focusMain?.(); onClick?.() }
  playChime()
  return true
}

// Fire everything due. A reminder that was due while the PC was off still
// fires when WorkLog next runs, as long as the task hasn't started yet.
export function checkReminders(onOpen) {
  if (!state.loaded) return
  const now = new Date()
  const t = today()
  const fired = loadFired()
  let changed = false
  for (const task of state.tasks) {
    const r = reminderFor(task)
    if (!r || startOf(task) < t) continue
    const at = fireAt(task, r)
    const key = `${task.id}|${startOf(task)}|${r.days}`
    if (at > now || fired[key]) continue
    fired[key] = t
    changed = true
    notify({ ...notificationText(task), tag: key }, () => onOpen(task.id))
  }
  if (changed) saveFired(fired)
}

export function testNotification() {
  return notify({ title: 'WorkLog reminders are on', body: `PV and R&D reminders will appear like this at ${state.prefs.remindTime}.`, tag: 'test', line: false })
}

export function startReminders(onOpen) {
  checkReminders(onOpen)
  setInterval(() => checkReminders(onOpen), 60_000)
}
