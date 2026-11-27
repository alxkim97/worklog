// App state + the selectors every view shares.
import { today, addDays } from './dates.js'
import { DEPTS, deptRank, STEPS } from '../lib/depts.js'
import { isSheet, isRdLine, isOpen, startOf, onDay, pvLots as sharedPvLots, searchTasks as sharedSearch } from '../lib/rd.js'

const PREFS_KEY = 'wl_prefs'
const CACHE_KEY = 'wl_cache'

const defaultPrefs = {
  production: 'all',           // all | pv | off — how much of the sheet to layer in
  hiddenDepts: [],             // dept keys switched off
  theme: 'system',             // system | light | dark
  planMode: 'week',            // the Plan view's last mode: week | month
  collapsed: false,            // desktop: hide the nav sidebar + month day panel
  remindTime: '08:30',         // when reminders fire on their day
  pvRemind: null,              // extra heads-up before PV steps: days before (null = off; the daily digest covers the day)
  changeAlerts: true,          // notify when the sheet moves a PV / R&D-line step
  sound: true,                 // soft chime with notifications
}

function loadPrefs() {
  let p
  try { p = { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } } catch { p = { ...defaultPrefs } }
  // v2.5: the daily digest replaces the old "1 day before" PV default, once.
  if (!p.digestMigrated) {
    if (p.pvRemind === 1) p.pvRemind = null
    p.digestMigrated = true
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch {}
  }
  return p
}

export const state = {
  session: null,
  member: null,                // null = unknown, false = signed in but not on worklog_members
  tasks: [],
  notes: [],
  lastRun: null,
  syncing: false,
  loginOpen: null,             // desktop: starts with Windows? (null = not applicable)
  loaded: false,
  view: 'month',               // week | month | lots | summary | settings | search (set from prefs at load)
  cursor: today(),             // anchor date for week/month
  sumCursor: today(),          // anchor date for the R&D Summary (month or year)
  selected: today(),           // selected day in month view
  search: '',
  prefs: loadPrefs(),
}

export function savePrefs(patch) {
  Object.assign(state.prefs, patch)
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)) } catch {}
}

// Last good data, so the app opens instantly (and offline) on the phone.
export function cacheData() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ tasks: state.tasks, notes: state.notes, lastRun: state.lastRun })) } catch {}
}
export function restoreCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (c) Object.assign(state, { tasks: c.tasks || [], notes: c.notes || [], lastRun: c.lastRun || null })
    return !!c
  } catch { return false }
}
export const clearCache = () => { try { localStorage.removeItem(CACHE_KEY) } catch {} }

// ── Task predicates (the shared ones live in lib/rd.js) ──
export { isSheet, isRdLine, isOpen, startOf, onDay }
export const isProduction = t => isSheet(t) && t.type !== 'pv_lot'
// "Mine" = anything with a status worth tracking: your own tasks + PV lots.
export const isTracked = t => !isProduction(t)
export const isOverdue = t => isTracked(t) && isOpen(t) && !!t.due_date && t.due_date < today()

export function visible(t) {
  if (state.prefs.hiddenDepts.includes(t.section || 'other')) return false
  if (isProduction(t)) return state.prefs.production === 'all' || (state.prefs.production === 'pv' && isRdLine(t))
  if (isSheet(t)) return state.prefs.production !== 'off'
  return true
}

const STATUS_RANK = { in_progress: 0, pending: 1, deferred: 2, done: 3 }
const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 }
export function byImportance(a, b) {
  return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
    (a.due_date || '9').localeCompare(b.due_date || '9') ||
    a.title.localeCompare(b.title)
}
export function byDeptStep(a, b) {
  return deptRank(a.section) - deptRank(b.section) ||
    stepRank(a.step) - stepRank(b.step) ||
    (a.product_name || a.title).localeCompare(b.product_name || b.title)
}
const stepRank = s => { const i = STEPS.indexOf(s); return i === -1 ? -1 : i }

// One day's content, split the way every view shows it.
export function dayContent(d, tasks = state.tasks) {
  const on = tasks.filter(t => visible(t) && onDay(t, d))
  return {
    mine: on.filter(isTracked).sort(byImportance),
    production: on.filter(isProduction).sort(byDeptStep),
    notes: state.notes.filter(n => n.note_date === d),
  }
}

// Production grouped by department, in department order.
export function groupByDept(tasks) {
  const groups = new Map()
  for (const t of tasks) {
    const k = t.section || 'other'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t)
  }
  return DEPTS.filter(d => groups.has(d.key)).map(d => ({ dept: d, tasks: groups.get(d.key) }))
}

export function counts() {
  const t = today()
  const mine = state.tasks.filter(x => isTracked(x) && visible(x))
  return {
    today: mine.filter(x => onDay(x, t) && isOpen(x)).length,
    overdue: mine.filter(isOverdue).length,
    week: mine.filter(x => isOpen(x) && x.due_date && x.due_date > t && x.due_date <= addDays(t, 7)).length,
    production: state.tasks.filter(x => isProduction(x) && onDay(x, t)).length,
  }
}

// PV lots and search: shared logic in lib/rd.js (also used by the CLI).
export const pvLots = () => sharedPvLots(state.tasks, today())
export const searchTasks = q => sharedSearch(state.tasks, q)
