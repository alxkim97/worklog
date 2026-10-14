import './style.css'
import { isConfigured } from './config.js'
import { getSession, onAuthChange, isMember, fetchTasks, fetchNotes, lastSyncRun, triggerSync, updateTask, addNote, deleteNote, signOut } from './data.js'
import { state, savePrefs, cacheData, restoreCache, clearCache, counts, isProduction } from './store.js'
import { today, addDays, addMonths, timeAgo } from './dates.js'
import { esc, icon, toast, closeTopModal, modalOpen } from './ui.js'
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

async function load() {
  try {
    const [tasks, notes, run] = await Promise.all([fetchTasks(), fetchNotes(), lastSyncRun()])
    Object.assign(state, { tasks, notes, lastRun: run, loaded: true })
    cacheData()
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
const NAV = [
  { view: 'today', label: 'Today', icon: 'sun' },
  { view: 'week', label: 'Week', icon: 'week' },
  { view: 'month', label: 'Month', icon: 'month' },
  { view: 'lots', label: 'PV lots', icon: 'flask' },
  { view: 'settings', label: 'Settings', icon: 'settings' },
]
const TITLES = { today: 'Today', lots: 'PV lots', settings: 'Settings', search: 'Search' }
const viewTitle = () => state.view === 'settings' && isPhone() ? 'More' : state.view === 'week' ? weekTitle() : state.view === 'month' ? monthTitle() : TITLES[state.view]

function content() {
  const phone = isPhone()
  switch (state.view) {
    case 'week': return renderWeek({ isPhone: phone })
    case 'month': return renderMonth()
    case 'lots': return renderLots()
    case 'settings': return renderSettings({ isPhone: phone })
    case 'search': return renderSearch({ isPhone: phone })
    default: return renderToday()
  }
}

const periodNav = () => ['week', 'month'].includes(state.view) ? `
  <div class="period">
    <button class="icon-btn" data-act="prev" aria-label="Previous">${icon('left')}</button>
    <button class="btn soft small" data-act="today">Today</button>
    <button class="icon-btn" data-act="next" aria-label="Next">${icon('right')}</button>
  </div>` : ''

const layerToggle = () => ['week', 'month'].includes(state.view) ? `
  <div class="seg small" title="Production layer">
    ${[['all', 'All'], ['pv', 'PV'], ['off', 'Mine']].map(([v, l]) => `<button type="button" class="${state.prefs.production === v ? 'on' : ''}" data-act="layer" data-value="${v}">${l}</button>`).join('')}
  </div>` : ''

function syncButton(compact) {
  const run = state.lastRun
  const failed = run?.ok === false
  return `<button class="sync-btn${state.syncing ? ' spinning' : ''}${failed ? ' failed' : ''}" data-act="sync" title="${esc(syncSummary(run))}" ${state.syncing ? 'disabled' : ''}>
    ${icon('sync', 16)}${compact ? '' : `<span>${state.syncing ? 'Syncing…' : failed ? 'Sync failed' : run ? `Synced ${timeAgo(run.finished_at || run.started_at)}` : 'Sync plan'}</span>`}
  </button>`
}

function desktopShell() {
  const c = counts()
  const badge = { today: c.today + c.overdue || '', lots: '' }
  return `
    <div class="shell desktop">
      <aside class="sidebar">
        <div class="brand"><span class="logo">W</span><span>WorkLog</span></div>
        <button class="btn primary block new-btn" data-act="new">${icon('plus', 18)} New task <kbd>N</kbd></button>
        <nav>
          ${NAV.map(n => `<button class="nav-item${state.view === n.view ? ' on' : ''}" data-act="nav" data-view="${n.view}">${icon(n.icon, 18)}<span>${n.label}</span>${badge[n.view] ? `<b class="nav-badge${c.overdue && n.view === 'today' ? ' red' : ''}">${badge[n.view]}</b>` : ''}</button>`).join('')}
        </nav>
        <div class="sidebar-foot">${syncButton(false)}<p class="version">v${__APP_VERSION__}</p></div>
      </aside>
      <main class="main">
        <header class="topbar">
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
    { view: 'week', label: 'Week', icon: 'week' },
    { add: true },
    { view: 'month', label: 'Month', icon: 'month' },
    { view: 'settings', label: 'More', icon: 'more', also: ['lots', 'search'] },
  ]
  return `
    <div class="shell phone">
      <header class="phone-top">
        ${state.view === 'today' ? `<div class="brand"><span class="logo">W</span><span>WorkLog</span></div>` : `<h1>${esc(viewTitle())}</h1>`}
        <div class="phone-top-right">
          ${['week', 'month'].includes(state.view) ? `<button class="icon-btn" data-act="prev" aria-label="Previous">${icon('left')}</button><button class="icon-btn" data-act="next" aria-label="Next">${icon('right')}</button>` : ''}
          ${state.view !== 'search' ? `<button class="icon-btn" data-act="nav" data-view="search" aria-label="Search">${icon('search')}</button>` : ''}
          ${syncButton(true)}
        </div>
      </header>
      ${['week', 'month'].includes(state.view) ? `<div class="phone-sub">${layerToggle()}<button class="btn soft small" data-act="today">Today</button></div>` : ''}
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
}
PHONE.addEventListener('change', render)

function setView(view) {
  state.view = view
  if (view === 'week' || view === 'month') state.cursor = state.cursor || today()
  render()
  root.querySelector('.content')?.scrollTo(0, 0)
  if (view === 'search') root.querySelector('#search-input')?.focus()
}

function move(dir) {
  if (state.view === 'week') state.cursor = addDays(state.cursor, 7 * dir)
  else if (state.view === 'month') { state.cursor = addMonths(state.cursor, dir); state.selected = state.cursor.slice(0, 7) === today().slice(0, 7) ? today() : state.cursor }
  render()
}

// ── Interaction (one delegated handler) ──────────────────────────────────
const NEXT_STATUS = { pending: 'in_progress', in_progress: 'done', done: 'pending', deferred: 'pending' }

async function cycleStatus(id) {
  const t = state.tasks.find(x => x.id === id)
  if (!t || isProduction(t)) return
  const prev = t.status
  t.status = NEXT_STATUS[prev]
  render()
  try {
    Object.assign(t, await updateTask(id, { status: t.status }))
    cacheData()
    if (t.status === 'done') toast('Done ✓', { label: 'Undo', run: () => setStatus(id, prev) })
  } catch (e) { t.status = prev; render(); toast(e.message) }
}
async function setStatus(id, status) {
  const t = state.tasks.find(x => x.id === id)
  if (!t) return
  t.status = status
  render()
  try { Object.assign(t, await updateTask(id, { status })); render() } catch (e) { toast(e.message) }
}

root.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]')
  if (!el || !root.contains(el)) return
  const { act, id, view, date, value } = el.dataset
  if (act !== 'open' && act !== 'select') e.stopPropagation()
  switch (act) {
    case 'nav': return setView(view)
    case 'new': return openEditor({ date: date || (state.view === 'month' ? state.selected : today()) }, render)
    case 'open': return openEditor({ id }, render)
    case 'cycle': e.stopPropagation(); return cycleStatus(id)
    case 'prev': return move(-1)
    case 'next': return move(1)
    case 'today': state.cursor = today(); state.selected = today(); return render()
    case 'select':
      state.selected = date
      root.querySelectorAll('.mg-day.sel').forEach(x => x.classList.remove('sel'))
      el.classList.add('sel')
      refreshDay()
      return
    case 'day': state.view = 'month'; state.cursor = date; state.selected = date; return render()
    case 'layer': savePrefs({ production: value }); return render()
    case 'dept': {
      const h = new Set(state.prefs.hiddenDepts)
      h.has(value) ? h.delete(value) : h.add(value)
      savePrefs({ hiddenDepts: [...h] })
      return render()
    }
    case 'theme': savePrefs({ theme: value }); applyTheme(value); return render()
    case 'sync': return sync()
    case 'export': return exportCsv(state.tasks)
    case 'signout': await signOut(); return
    case 'update': return window.electronAPI?.checkForUpdates()
    case 'del-note': {
      try { await deleteNote(id); state.notes = state.notes.filter(n => n.id !== id); cacheData(); refreshDay() } catch (err) { toast(err.message) }
      return
    }
  }
})

// Keyboard: Enter/Space on a focused task or day opens it.
root.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="open"],[data-act="select"]')) { e.preventDefault(); e.target.click() }
})

root.addEventListener('submit', async e => {
  const form = e.target.closest('.note-add')
  if (!form) return
  e.preventDefault()
  const input = form.elements.note
  const text = input.value.trim()
  if (!text) return
  input.disabled = true
  try {
    state.notes.push(await addNote(form.dataset.date, text))
    cacheData()
    refreshDay()
    root.querySelector(`.note-add[data-date="${form.dataset.date}"] input`)?.focus()
  } catch (err) { toast(err.message); input.disabled = false }
})

// Re-render without losing the month view's day panel position.
function refreshDay() {
  const panel = root.querySelector('.day-panel')
  if (state.view === 'month' && panel) panel.innerHTML = dayPanel(state.selected)
  else render()
}

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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (closeTopModal()) return; if (state.view === 'search') { state.search = ''; setView('today') } return }
  const typing = e.target.closest('input, textarea, select, [contenteditable]')
  if (typing || modalOpen() || e.ctrlKey || e.metaKey || e.altKey || !state.member) return
  const keys = {
    n: () => openEditor({ date: state.view === 'month' ? state.selected : today() }, render),
    t: () => { state.cursor = today(); state.selected = today(); render() },
    '1': () => setView('today'), '2': () => setView('week'), '3': () => setView('month'), '4': () => setView('lots'),
    '/': () => root.querySelector('#search-input')?.focus() ?? setView('search'),
    ArrowLeft: () => move(-1), ArrowRight: () => move(1),
  }
  const fn = keys[e.key]
  if (fn) { e.preventDefault(); fn() }
})

// iOS ignores user-scalable=no; block pinch zoom like Coin does.
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false })

initUpdateReload({ isBusy: modalOpen })
boot()

// Keep "Synced 5m ago" honest on a window left open all day.
setInterval(() => { if (state.member && !modalOpen() && document.visibilityState === 'visible' && !document.activeElement?.closest('input,textarea')) render() }, 60_000)


// Electron's global shortcut (Ctrl+Shift+L, main.cjs) focuses the window and
// sends 'add'.
window.electronAPI?.onNavigate?.(view => { if (view === 'add' && state.member && !modalOpen()) openEditor({ date: today() }, render) })
