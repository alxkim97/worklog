import { isConfigured } from './config.js'
import { getSession, onAuthChange, isMember, fetchTasks, fetchNotes, lastSyncRun, triggerSync, updateTask, addNote, deleteNote, signOut } from './data.js'
import { state, savePrefs, cacheData, restoreCache, clearCache, counts, isProduction } from './store.js'
import { today, addDays, addMonths, timeAgo } from './dates.js'
import { esc, icon, toast, closeTopModal, modalOpen, openModal } from './ui.js'
import { startReminders, testNotification, askPermission, canNotify } from './reminders.js'
import { diffPlan, recordPlanChanges, clearChanges } from './planChanges.js'
import { printFileName } from './views/week.js'
import { renderAuth, renderNotMember, renderNotConfigured } from './views/auth.js'
import { renderToday } from './views/today.js'
import { renderWeek, weekTitle } from './views/week.js'
import { renderMonth, monthTitle, dayPanel } from './views/month.js'
import { renderLots } from './views/lots.js'
import { renderSettings, syncSummary } from './views/settings.js'
import { renderSearch } from './views/search.js'
import { openEditor } from './editor.js'
import { applyTheme } from './theme.js'
import { initUpdateReload } from './swUpdate.js'
import { exportCsv } from './exportCsv.js'
import { playChime } from './sound.js'
import { setUndoRender, undo, redo, undoIf, putTask, snapshot, nameOf, recordUpdate, recordNoteAdd, recordNoteDelete } from './undo.js'
import { renderSummary, summaryTitle, moveSummary, sumMode, summaryFileName, retrySummary } from './views/summary.js'
import { openReport } from './report.js'
import { postLine } from './line.js'

const root = document.getElementById('app')
const PHONE = window.matchMedia('(max-width: 859px)')
const isPhone = () => PHONE.matches
const SYNC_STALE_MS = 60 * 60 * 1000

applyTheme(state.prefs.theme)

// ── Boot / auth ──────────────────────────────────────────────────────────
async function boot() {
  if (!isConfigured() && import.meta.env.MODE !== 'demo') return renderNotConfigured(root)
  state.session = await getSession()
  onAuthChange(session => {
    const was = state.session?.user?.id
    state.session = session
    if (session?.user?.id !== was) start()
  })
  start()
}

async function start() {
  if (!state.session) { clearCache(); state.member = null; return renderAuth(root) }
  if (restoreCache()) { state.member = true; state.loaded = true; render() }
  try {
    state.member = await isMember(state.session.user.id)
  } catch (e) {
    if (!state.loaded) { root.innerHTML = `<div class="auth"><div class="auth-card"><h2>Can't reach WorkLog</h2><p class="auth-sub">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Retry</button></div></div>`; return }
    toast('Offline — showing saved data')
    return
  }
  if (!state.member) { clearCache(); return renderNotMember(root, state.session.user, start) }
  await load()
  maybeAutoSync()
}

let remindersStarted = false
async function load() {
  try {
    const [tasks, notes, run] = await Promise.all([fetchTasks(), fetchNotes(), lastSyncRun()])
    // what you saw last (cache or previous load) vs. now: PV / R&D-line moves
    if (state.loaded && state.tasks.length) recordPlanChanges(diffPlan(state.tasks, tasks))
    Object.assign(state, { tasks, notes, lastRun: run, loaded: true })
    cacheData()
    if (!remindersStarted) { remindersStarted = true; startReminders(id => openEditor({ id }, render)) }
  } catch (e) {
    toast(e.message || 'Could not load')
  }
  render()
}

// ── Sync ─────────────────────────────────────────────────────────────────
async function sync({ quiet = false } = {}) {
  if (state.syncing) return
  state.syncing = true
  render()
  try {
    const r = await triggerSync()
    if (!quiet || r.added || r.removed) toast(r.added || r.removed ? `Plan updated · ${r.added} new${r.removed ? ` · ${r.removed} removed` : ''}` : 'Plan is up to date')
    state.syncing = false
    await load()
  } catch (e) {
    state.syncing = false
    state.lastRun = await lastSyncRun().catch(() => state.lastRun)
    if (!quiet) toast(e.message)
    render()
  }
}

function maybeAutoSync() {
  const last = state.lastRun?.started_at
  if (!last || Date.now() - new Date(last) > SYNC_STALE_MS) sync({ quiet: true })
}

// Coming back to the app (phone unlock, window focus) refreshes data.
let lastFocusLoad = Date.now()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.member) return
  if (Date.now() - lastFocusLoad < 60_000) return
  lastFocusLoad = Date.now()
  load().then(maybeAutoSync)
})

// ── Rendering ────────────────────────────────────────────────────────────
// Week and Month are two modes of one Plan view (switch in the top bar).
const PLAN = ['week', 'month']
const isPlan = v => PLAN.includes(v)
const NAV = [
  { view: 'today', label: 'Today', icon: 'sun', key: '1' },
  { view: 'plan', label: 'Plan', icon: 'week', key: '2 / 3' },
  { view: 'lots', label: 'PV lots', icon: 'flask', key: '4' },
  { view: 'summary', label: 'Summary', icon: 'chart', key: '5' },
  { view: 'settings', label: 'Settings', icon: 'settings' },
]
const navOn = v => state.view === v || (v === 'plan' && isPlan(state.view))
const TITLES = { today: 'Today', lots: 'PV lots', settings: 'Settings', search: 'Search' }
const viewTitle = () => state.view === 'settings' && isPhone() ? 'More' : state.view === 'week' ? weekTitle() : state.view === 'month' ? monthTitle() : state.view === 'summary' ? summaryTitle() : TITLES[state.view]
// Views with a period and back/forward arrows.
const hasPeriod = () => isPlan(state.view) || state.view === 'summary'

function content() {
  const phone = isPhone()
  switch (state.view) {
    case 'week': return renderWeek({ isPhone: phone })
    case 'month': return renderMonth({ wide: !phone && state.prefs.collapsed })
    case 'lots': return renderLots()
    case 'summary': return renderSummary({ rerender: render })
    case 'settings': return renderSettings({ isPhone: phone })
    case 'search': return renderSearch({ isPhone: phone })
    default: return renderToday()
  }
}

const planSwitch = () => isPlan(state.view) ? `
  <div class="seg small plan-switch" role="radiogroup" aria-label="Plan">
    ${[['week', 'Week'], ['month', 'Month']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${state.view === v}" class="${state.view === v ? 'on' : ''}" data-act="nav" data-view="${v}">${l}</button>`).join('')}
  </div>` : state.view === 'summary' ? `
  <div class="seg small plan-switch" role="radiogroup" aria-label="Summary period">
    ${[['month', 'Month'], ['year', 'Year']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${sumMode() === v}" class="${sumMode() === v ? 'on' : ''}" data-act="sum-mode" data-value="${v}">${l}</button>`).join('')}
  </div>` : ''

const periodNav = () => hasPeriod() ? `
  <div class="period">
    <button class="icon-btn" data-act="prev" aria-label="Previous">${icon('left')}</button>
    <button class="btn soft small" data-act="today">${state.view === 'summary' ? (sumMode() === 'year' ? 'This year' : 'This month') : 'Today'}</button>
    <button class="icon-btn" data-act="next" aria-label="Next">${icon('right')}</button>
    ${state.view === 'week' ? `<button class="icon-btn" data-act="print" title="Print or save this week as PDF" aria-label="Print week">${icon('printer', 18)}</button>` : ''}
    ${state.view === 'summary' ? `<button class="icon-btn" data-act="print" title="Print or save this summary as PDF" aria-label="Print summary">${icon('printer', 18)}</button>
      <button class="btn soft small report-btn" data-act="report" title="A Markdown report for a day or range">${icon('doc', 15)} Make report</button>` : ''}
  </div>` : ''

const layerToggle = () => isPlan(state.view) ? `
  <div class="seg small" title="Production layer">
    ${[['all', 'All'], ['pv', isPhone() ? 'PV' : 'PV + R&D'], ['off', 'Mine']].map(([v, l]) => `<button type="button" class="${state.prefs.production === v ? 'on' : ''}" data-act="layer" data-value="${v}">${l}</button>`).join('')}
  </div>` : ''

function syncButton(compact) {
  const run = state.lastRun
  const failed = run?.ok === false
  return `<button class="sync-btn${state.syncing ? ' spinning' : ''}${failed ? ' failed' : ''}" data-act="sync" title="${esc(syncSummary(run))}" ${state.syncing ? 'disabled' : ''}>
    ${icon('sync', 16)}${compact ? '' : `<span>${state.syncing ? 'Syncing…' : failed ? 'Sync failed' : run ? `Synced ${timeAgo(run.finished_at || run.started_at)}` : 'Sync plan'}</span>`}
  </button>`
}

const collapseBtn = () => `<button class="icon-btn collapse-btn" data-act="collapse" aria-label="${state.prefs.collapsed ? 'Show' : 'Hide'} sidebars" title="${state.prefs.collapsed ? 'Show' : 'Hide'} sidebars  ( \\ )">${icon('sidebar', 19)}</button>`

function desktopShell() {
  const c = counts()
  const badge = { today: c.today + c.overdue || '', lots: '' }
  const collapsed = state.prefs.collapsed
  return `
    <div class="shell desktop${collapsed ? ' collapsed' : ''}">
      <aside class="sidebar">
        <div class="brand"><img class="logo" src="./favicon.svg" alt=""><span>WorkLog</span></div>
        <button class="btn primary block new-btn" data-act="new">${icon('plus', 18)} New task <kbd>N</kbd></button>
        <nav>
          ${NAV.map(n => `<button class="nav-item${navOn(n.view) ? ' on' : ''}" data-act="nav" data-view="${n.view}">${icon(n.icon, 18)}<span>${n.label}</span>${badge[n.view] ? `<b class="nav-badge${c.overdue && n.view === 'today' ? ' red' : ''}">${badge[n.view]}</b>` : ''}</button>`).join('')}
        </nav>
        <div class="sidebar-foot">
          ${window.electronAPI?.widget ? `<button class="sync-btn" data-act="widget" title="Open the calendar widget on your desktop">${icon('pin', 16)}<span>Pin calendar to desktop</span></button>` : ''}
          ${syncButton(false)}<p class="version">v${__APP_VERSION__} · Alex Kim</p>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          ${collapseBtn()}
          ${collapsed ? `<nav class="mini-nav">${NAV.filter(n => n.key).map(n => `<button class="icon-btn${navOn(n.view) ? ' on' : ''}" data-act="nav" data-view="${n.view}" title="${n.label}  (${n.key})" aria-label="${n.label}">${icon(n.icon, 18)}</button>`).join('')}<button class="icon-btn" data-act="new" title="New task  (N)" aria-label="New task">${icon('plus', 18)}</button></nav>` : ''}
          ${planSwitch()}
          <h1>${esc(viewTitle())}</h1>
          ${periodNav()}
          <div class="topbar-right">
            ${layerToggle()}
            <label class="search-box">${icon('search', 16)}<input type="search" id="search-input" placeholder="Search  /" value="${esc(state.search)}" autocomplete="off"></label>
          </div>
        </header>
        <div class="content view-${state.view}">${content()}</div>
      </main>
    </div>`
}

function phoneShell() {
  const c = counts()
  const tabs = [
    { view: 'today', label: 'Today', icon: 'sun', badge: c.overdue },
    { view: 'plan', label: 'Plan', icon: 'week', also: PLAN },
    { add: true },
    { view: 'lots', label: 'PV lots', icon: 'flask' },
    { view: 'settings', label: 'More', icon: 'more', also: ['search', 'summary'] },
  ]
  return `
    <div class="shell phone">
      <header class="phone-top">
        ${state.view === 'today' ? `<div class="brand"><img class="logo" src="./favicon.svg" alt=""><span>WorkLog</span></div>` : `<h1>${esc(viewTitle())}</h1>`}
        <div class="phone-top-right">
          ${hasPeriod() ? `<button class="icon-btn" data-act="prev" aria-label="Previous">${icon('left')}</button><button class="icon-btn" data-act="next" aria-label="Next">${icon('right')}</button>` : ''}
          ${state.view !== 'search' ? `<button class="icon-btn" data-act="nav" data-view="search" aria-label="Search">${icon('search')}</button>` : ''}
          ${syncButton(true)}
        </div>
      </header>
      ${isPlan(state.view) ? `<div class="phone-sub">${planSwitch()}${layerToggle()}<button class="btn soft small" data-act="today">Today</button></div>` : ''}
      ${state.view === 'summary' ? `<div class="phone-sub">${planSwitch()}<button class="btn soft small" data-act="report">${icon('doc', 15)} Report</button></div>` : ''}
      <main class="content view-${state.view}">${content()}</main>
      <nav class="tabbar">
        ${tabs.map(t => t.add
          ? `<button class="tab-add" data-act="new" aria-label="New task">${icon('plus', 26)}</button>`
          : `<button class="tab${state.view === t.view || t.also?.includes(state.view) ? ' on' : ''}" data-act="nav" data-view="${t.view}">${icon(t.icon, 22)}<span>${t.label}</span>${t.badge ? `<b class="tab-badge">${t.badge}</b>` : ''}</button>`).join('')}
      </nav>
    </div>`
}

let lastShell = ''
function render() {
  if (!state.member) return
  const active = document.activeElement
  const searchFocused = active?.id === 'search-input'
  const caret = searchFocused ? active.selectionStart : null
  const scroller = root.querySelector('.content')
  const scroll = scroller && lastShell === state.view ? scroller.scrollTop : 0
  root.innerHTML = isPhone() ? phoneShell() : desktopShell()
  lastShell = state.view
  const sc = root.querySelector('.content')
  if (sc && scroll) sc.scrollTop = scroll
  if (searchFocused) {
    const inp = root.querySelector('#search-input')
    if (inp) { inp.focus(); inp.setSelectionRange(caret, caret) }
  }
  document.querySelectorAll('.overlay .day-panel').forEach(p => { p.innerHTML = dayPanel(p.dataset.date) })
}
PHONE.addEventListener('change', render)

function setView(view) {
  if (view === 'plan') view = state.prefs.planMode === 'month' ? 'month' : 'week'
  if (isPlan(view) && state.prefs.planMode !== view) savePrefs({ planMode: view })
  state.view = view
  if (isPlan(view)) state.cursor = state.cursor || today()
  render()
  root.querySelector('.content')?.scrollTo(0, 0)
  if (view === 'search') root.querySelector('#search-input')?.focus()
}

function move(dir) {
  if (state.view === 'summary') moveSummary(dir)
  else if (state.view === 'week') state.cursor = addDays(state.cursor, 7 * dir)
  else if (state.view === 'month') { state.cursor = addMonths(state.cursor, dir); state.selected = state.cursor.slice(0, 7) === today().slice(0, 7) ? today() : state.cursor }
  render()
}

// ── Interaction (one delegated handler) ──────────────────────────────────
const NEXT_STATUS = { pending: 'in_progress', in_progress: 'done', done: 'pending', deferred: 'pending' }

async function cycleStatus(id) {
  const t = state.tasks.find(x => x.id === id)
  if (!t || isProduction(t)) return
  const prev = t.status
  const before = snapshot(t, { status: null }) // an auto-done step is 'pending' in the database
  const wasAuto = t.auto_done
  // an auto-done plan step reopens as 'Doing' — 'To do' would just read as done again
  t.status = t.auto_done ? 'in_progress' : NEXT_STATUS[prev]
  delete t.auto_done
  render()
  try {
    const next = { status: t.status }
    putTask(await updateTask(id, next))
    cacheData()
    render()
    const label = { pending: 'To do', in_progress: 'Doing', done: 'Done', deferred: 'Later' }[next.status]
    const entry = recordUpdate(`${nameOf(t)} → ${label}`, id, before, next)
    if (next.status === 'done') toast('Done ✓', { label: 'Undo', run: () => undoIf(entry) })
  } catch (e) { t.status = prev; if (wasAuto) t.auto_done = true; render(); toast(e.message) }
}

async function onClick(e) {
  const el = e.target.closest('[data-act]')
  if (!el || !e.currentTarget.contains(el)) return
  const { act, id, view, date, value } = el.dataset
  if (act !== 'open' && act !== 'select') e.stopPropagation()
  switch (act) {
    case 'nav': return setView(view)
    case 'new': return openEditor({ date: date || (state.view === 'month' ? state.selected : today()) }, render)
    case 'open': return openEditor({ id }, render)
    case 'cycle': e.stopPropagation(); return cycleStatus(id)
    case 'prev': return move(-1)
    case 'next': return move(1)
    case 'today': state.cursor = today(); state.selected = today(); state.sumCursor = today(); return render()
    case 'sum-mode': savePrefs({ sumMode: value }); return render()
    case 'sum-month': savePrefs({ sumMode: 'month' }); state.sumCursor = date; return render()
    case 'sum-retry': retrySummary(); return render()
    case 'report': return openReport()
    case 'select':
      state.selected = date
      // sidebars hidden: no day panel on the page, so the day opens as a popup
      if (state.view === 'month' && !root.querySelector('.day-panel')) { render(); return openDay(date) }
      root.querySelectorAll('.mg-day.sel').forEach(x => x.classList.remove('sel'))
      el.classList.add('sel')
      refreshDay()
      return
    case 'day': state.view = 'month'; state.cursor = date; state.selected = date; return render()
    case 'layer': savePrefs({ production: value }); return render()
    case 'line': savePrefs({ line: value === 'on' }); return render()
    case 'login':
      try { state.loginOpen = await window.electronAPI.login.set(value === 'on') } catch (err) { toast(err.message) }
      return render()
    case 'test-line':
      el.disabled = true
      try { await postLine('WorkLog\nLINE is connected — reminders and plan changes will arrive here.'); toast('Sent — check LINE') } catch (err) { toast(err.message) }
      el.disabled = false
      return
    case 'dept': {
      const h = new Set(state.prefs.hiddenDepts)
      h.has(value) ? h.delete(value) : h.add(value)
      savePrefs({ hiddenDepts: [...h] })
      return render()
    }
    case 'theme': savePrefs({ theme: value }); applyTheme(value); return render()
    case 'collapse': return toggleCollapsed()
    case 'print': return printView()
    case 'clear-changes': clearChanges(); return render()
    case 'change-alerts': savePrefs({ changeAlerts: value === 'on' }); if (value === 'on') askPermission(); return render()
    case 'widget': return window.electronAPI?.widget?.toggle()
    case 'pv-remind': savePrefs({ pvRemind: value === 'off' ? null : Number(value) }); if (value !== 'off') askPermission(); return render()
    case 'sound': savePrefs({ sound: value === 'on' }); if (value === 'on') playChime({ force: true }); return render()
    case 'test-sound': return playChime({ force: true })
    case 'test-notify':
      if (!(await askPermission())) return toast(canNotify() ? 'Notifications are blocked — allow them for WorkLog first' : 'Notifications aren’t available here')
      testNotification()
      return
    case 'sync': return sync()
    case 'export': return exportCsv(state.tasks)
    case 'signout': await signOut(); return
    case 'update': return window.electronAPI?.checkForUpdates()
    case 'del-note': {
      const note = state.notes.find(n => n.id === id)
      try {
        await deleteNote(id); state.notes = state.notes.filter(n => n.id !== id); cacheData(); refreshDay()
        if (note) { const entry = recordNoteDelete(note); toast('Note deleted', { label: 'Undo', run: () => undoIf(entry) }) }
      } catch (err) { toast(err.message) }
      return
    }
  }
}
root.addEventListener('click', onClick)

// Desktop app: straight to a PDF (save dialog, then it opens). Browser: the
// print dialog, where "Save as PDF" does the same.
async function printView() {
  const summary = state.view === 'summary'
  if (window.electronAPI?.printPdf) {
    try {
      const file = await window.electronAPI.printPdf(summary ? { name: summaryFileName(), landscape: false } : printFileName())
      if (file) toast('Saved PDF')
    } catch (e) { toast(e.message || 'Could not make the PDF') }
  } else window.print()
}

function toggleCollapsed() {
  savePrefs({ collapsed: !state.prefs.collapsed })
  render()
}

// A day as a popup (month view with the sidebars hidden).
function openDay(d) {
  const m = openModal(`
    <button type="button" class="icon-btn modal-x" data-close aria-label="Close">${icon('x')}</button>
    <div class="day-panel in-modal" data-date="${d}">${dayPanel(d)}</div>`, { wide: true })
  m.el.addEventListener('click', onClick)
  m.el.addEventListener('submit', onSubmit)
  m.el.addEventListener('keydown', onKeyOpen)
}

// Keyboard: Enter/Space on a focused task or day opens it.
function onKeyOpen(e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="open"],[data-act="select"]')) { e.preventDefault(); e.target.click() }
}
root.addEventListener('keydown', onKeyOpen)

async function onSubmit(e) {
  const form = e.target.closest('.note-add')
  if (!form) return
  e.preventDefault()
  const input = form.elements.note
  const text = input.value.trim()
  if (!text) return
  input.disabled = true
  try {
    const note = await addNote(form.dataset.date, text)
    state.notes.push(note)
    recordNoteAdd(note)
    cacheData()
    refreshDay()
    ;(document.querySelector(`.overlay .note-add[data-date="${form.dataset.date}"] input`) ||
      root.querySelector(`.note-add[data-date="${form.dataset.date}"] input`))?.focus()
  } catch (err) { toast(err.message); input.disabled = false }
}
root.addEventListener('submit', onSubmit)

// Re-render without losing the month view's day panel position.
function refreshDay() {
  document.querySelectorAll('.overlay .day-panel').forEach(p => { p.innerHTML = dayPanel(p.dataset.date) })
  const panel = root.querySelector('.day-panel')
  if (state.view === 'month' && panel) panel.innerHTML = dayPanel(state.selected)
  else render()
}

root.addEventListener('change', e => {
  if (e.target.id === 'remind-time' && e.target.value) { savePrefs({ remindTime: e.target.value }); toast(`Reminders at ${e.target.value}`) }
})

let searchTimer
root.addEventListener('input', e => {
  if (e.target.id !== 'search-input') return
  state.search = e.target.value
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (state.search.trim() && state.view !== 'search') state.view = 'search'
    render()
  }, 120)
})

// Desktop shortcuts.
// Text-entry fields keep the browser's own undo; checkboxes and radios don't
// have one, so Ctrl+Z there undoes the last action instead.
const textEntry = el => !!el?.closest?.('textarea, [contenteditable], select') ||
  (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type))

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (closeTopModal()) return; if (state.view === 'search') { state.search = ''; setView('today') } return }
  const k = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y') && state.member) {
    if (textEntry(e.target)) return
    e.preventDefault()
    if (k === 'y' || e.shiftKey) redo(); else undo()
    return
  }
  const typing = e.target.closest('input, textarea, select, [contenteditable]')
  if (typing || modalOpen() || e.ctrlKey || e.metaKey || e.altKey || !state.member) return
  const keys = {
    n: () => openEditor({ date: state.view === 'month' ? state.selected : today() }, render),
    t: () => { state.cursor = today(); state.selected = today(); render() },
    '1': () => setView('today'), '2': () => setView('week'), '3': () => setView('month'), '4': () => setView('lots'), '5': () => setView('summary'),
    '/': () => root.querySelector('#search-input')?.focus() ?? setView('search'),
    '\\': () => { if (!isPhone()) toggleCollapsed() },
    ArrowLeft: () => move(-1), ArrowRight: () => move(1),
  }
  const fn = keys[e.key]
  if (fn) { e.preventDefault(); fn() }
})

// iOS ignores user-scalable=no; block pinch zoom like Coin does.
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false })

window.electronAPI?.login?.get().then(v => { if (v != null) { state.loginOpen = v; if (state.view === 'settings') render() } }).catch(() => {})
initUpdateReload({ isBusy: modalOpen })
setUndoRender(render)
boot()

// Keep "Synced 5m ago" honest on a window left open all day.
setInterval(() => { if (state.member && !modalOpen() && document.visibilityState === 'visible' && !document.activeElement?.closest('input,textarea')) render() }, 60_000)


// Electron's global shortcut (Ctrl+Shift+L, main.cjs) focuses the window and
// sends 'add'.
// The month widget sends { view, date } (a day clicked) or { id } (a task).
window.electronAPI?.onNavigate?.(msg => {
  if (!state.member) return
  if (msg === 'add') { if (!modalOpen()) openEditor({ date: today() }, render); return }
  if (msg?.date) { state.view = msg.view || 'month'; state.cursor = msg.date; state.selected = msg.date; render() }
  if (msg?.id) openEditor({ id: msg.id }, render)
})
