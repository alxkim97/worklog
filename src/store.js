// App state + the selectors every view shares.
import { today, addDays } from './dates.js'
import { DEPTS, deptRank, STEPS } from '../lib/depts.js'

const PREFS_KEY = 'wl_prefs'
const CACHE_KEY = 'wl_cache'

const defaultPrefs = {
  production: 'all',           // all | pv | off — how much of the sheet to layer in
  hiddenDepts: [],             // dept keys switched off
  theme: 'system',             // system | light | dark
  planMode: 'week',            // the Plan view's last mode: week | month
  collapsed: false,            // desktop: hide the nav sidebar + month day panel
  remindTime: '08:30',         // when reminders fire on their day
  pvRemind: 1,                 // PV lots without their own setting: days before (null = off)
  changeAlerts: true,          // notify when the sheet moves a PV / R&D-line step
  sound: true,                 // soft chime with notifications
}

function loadPrefs() {
  try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } } catch { return { ...defaultPrefs } }
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
  view: 'today',               // today | week | month | lots | summary | settings | search
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

// ── Task predicates ──
export const isSheet = t => t.source === 'sheet'
export const isProduction = t => isSheet(t) && t.type !== 'pv_lot'
// "Mine" = anything with a status worth tracking: your own tasks + PV lots.
export const isTracked = t => !isProduction(t)
// Runs on the sheet's 'RD' machine line — production, but R&D's business.
export const isRdLine = t => isSheet(t) && (t.sheet_path || '').includes('R&D line')
export const isOpen = t => t.status === 'pending' || t.status === 'in_progress'
export const startOf = t => t.start_date && t.due_date && t.start_date < t.due_date ? t.start_date : t.due_date
export const onDay = (t, d) => !!t.due_date && startOf(t) <= d && d <= t.due_date
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

// PV lots: sheet pv_lot rows grouped into one card per product + lot.
export function pvLots() {
  const lots = new Map()
  for (const t of state.tasks) {
    if (t.type !== 'pv_lot' || !isSheet(t)) continue
    // Steps can carry a Thai prefix (e.g. 'prepare coating solution …') — group on the product itself.
    const name = (t.product_name || t.title).replace(/^[^A-Za-z0-9]+/, '')
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
  const t = today()
  // Active/upcoming first (by next date), finished ones after.
  return out.sort((a, b) => ((a.last < t) - (b.last < t)) || (a.last < t ? b.last.localeCompare(a.last) : a.first.localeCompare(b.first)))
}

export function searchTasks(q) {
  const s = q.trim().toLowerCase()
  if (!s) return []
  return state.tasks.filter(t => [t.title, t.product_name, t.lot_number, t.notes, t.sheet_path]
    .some(v => v && String(v).toLowerCase().includes(s)))
    .sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''))
    .slice(0, 200)
}
