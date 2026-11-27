import { isConfigured, WEB_URL } from './config.js'
import { getSession, onAuthChange, isMember, fetchTasks, fetchNotes, lastSyncRun, triggerSync, updateTask, addNote, deleteNote, signOut } from './data.js'
import { state, savePrefs, cacheData, restoreCache, clearCache, counts, isProduction, isSheet, isTracked, isOpen, visible, byImportance } from './store.js'
import { today, addDays, addMonths, timeAgo } from './dates.js'
import { esc, icon, toast, closeTopModal, modalOpen, openModal } from './ui.js'
import { deptColor as deptColorOf } from './components.js'
import { startReminders, testNotification, askPermission, canNotify } from './reminders.js'
import { diffPlan, recordPlanChanges, clearChanges } from './planChanges.js'
import { printFileName } from './views/week.js'
import { renderAuth, renderNotMember, renderNotConfigured } from './views/auth.js'
import { renderWeek, weekTitle, phoneTitle } from './views/week.js'
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
import { postLine, postDigest } from './line.js'
import { startDigest } from './digest.js'
import { getSetting, setSetting, fetchView } from './data.js'
import { readOnly, viewToken, leaveViewMode, newToken } from './viewMode.js'
import { marks, resetMarks } from './marks.js'
import { upcomingClashes } from './clashes.js'
import { relHint, relDay } from './dates.js'
import { nameOf as plainName } from '../lib/rd.js'
import { statusButton as statusButtonOf } from './components.js'
import { initPopover, clearMark } from './popover.js'
import { itemsOn, agendaItem } from './activity.js'
import { monthStart, weekStart, dayNum, shortDate, isWeekend } from './dates.js'
import { groupChanges } from '../lib/changeGroups.js'

const root = document.getElementById('app')
const PHONE = window.matchMedia('(max-width: 859px)')
const isPhone = () => PHONE.matches
const SYNC_STALE_MS = 60 * 60 * 1000

applyTheme(state.prefs.theme)
state.view = state.prefs.planMode === 'week' ? 'week' : 'month'

// ── Boot / auth ──────────────────────────────────────────────────────────
async function boot() {
  if (!isConfigured() && import.meta.env.MODE !== 'demo') return renderNotConfigured(root)
  // The secret view link: no sign-in, read-only, the plan from api/view.
  if (viewToken) { state.member = true; return load() }
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
async function load({ quiet = false } = {}) {
  if (viewToken) return loadView({ quiet })
  try {
    const [tasks, notes, run] = await Promise.all([fetchTasks(), fetchNotes(), lastSyncRun()])
    // what you saw last (cache or previous load) vs. now: PV / R&D-line moves
    if (state.loaded && state.tasks.length) recordPlanChanges(diffPlan(state.tasks, tasks))
    Object.assign(state, { tasks, notes, lastRun: run, loaded: true })
    cacheData()
    // the server-side switches (daily digest, weekend message); null = SQL part F not run
    getSetting('digest').then(v => { state.digest = v; if (state.view === 'settings') render() }, () => {})
    getSetting('view_link').then(v => { state.viewLink = v; if (state.view === 'settings') render() }, () => {})
    if (!remindersStarted) { remindersStarted = true; startReminders(id => openEditor({ id }, render)); startDigest() }
  } catch (e) {
    if (!quiet) toast(e.message || 'Could not load')
  }
  render()
}

// View link: the same plan, fetched with the token; nothing cached, no
// alerts, no reminders (this is someone looking, not the app running).
async function loadView({ quiet }) {
  try {
    Object.assign(state, await fetchView(viewToken), { loaded: true })
  } catch (e) {
    if (!state.loaded) {
      root.innerHTML = `<div class="auth"><div class="auth-card"><div class="brand big"><img class="logo" src="./favicon.svg" alt=""><span>WorkLog</span></div><h2>${e.status === 403 ? 'This link no longer works' : 'Can’t load WorkLog'}</h2><p class="auth-sub">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`
      return
    }
    if (!quiet) toast(e.message || 'Could not load')
  }
  render()
}

// Running in the tray all day: look at the plan every 15 minutes (and have
// the sheet re-synced when the last sync is over an hour old), so a moved
// PV / R&D-line step is noticed within minutes, not the next time the
// window opens. Skipped while you're typing on the page.
setInterval(() => {
  if (!state.member || modalOpen() || document.activeElement?.closest?.('input, textarea')) return
  lastFocusLoad = Date.now()
  load({ quiet: true }).then(maybeAutoSync)
}, 15 * 60_000)

// ── Sync ─────────────────────────────────────────────────────────────────
async function sync({ quiet = false } = {}) {
  if (state.syncing) return
  state.syncing = true
  render()
  try {
    const r = await triggerSync()
    if (r.running) { if (!quiet) toast('A sync is already running — try again in a minute') }
    else if (!quiet || r.added || r.removed) toast(r.added || r.removed ? `Plan updated · ${r.added} new${r.removed ? ` · ${r.removed} removed` : ''}${r.carried ? ` · kept your notes on ${r.carried} moved` : ''}` : 'Plan is up to date')
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
  if (viewToken) return
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
  { view: 'plan', label: 'Plan', icon: 'week', key: '1 / 2' },
  { view: 'lots', label: 'PV lots', icon: 'flask', key: '3' },
  { view: 'summary', label: 'Summary', icon: 'chart', key: '4' },
  { view: 'settings', label: 'Settings', icon: 'settings' },
]
const navOn = v => state.view === v || (v === 'plan' && isPlan(state.view))
const TITLES = { lots: 'PV lots', settings: 'Settings', search: 'Search' }
const viewTitle = () => state.view === 'settings' && isPhone() ? 'More' : state.view === 'week' ? weekTitle() : state.view === 'month' ? monthTitle() : state.view === 'summary' ? summaryTitle() : TITLES[state.view]
// Views with a period and back/forward arrows.
const hasPeriod = () => isPlan(state.view) || state.view === 'summary'

function content() {
  const phone = isPhone()
  switch (state.view) {
    case 'week': return renderWeek({ isPhone: phone })
    case 'month': return phone ? renderWeek({ isPhone: true }) : renderMonth()
    case 'lots': return renderLots()
    case 'summary': return renderSummary({ rerender: render })
    case 'settings': return renderSettings({ isPhone: phone })
    case 'search': return renderSearch({ isPhone: phone })
    default: return phone ? renderWeek({ isPhone: true }) : renderMonth()
  }
}

const planSwitch = () => isPlan(state.view) ? `
  <div class="seg small plan-switch" role="radiogroup" aria-label="Plan">
    ${[['week', 'Week'], ['month', 'Month']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${state.view === v}" class="${state.view === v ? 'on' : ''}" data-act="nav" data-view="${v}">${l}</button>`).join('')}
  </div>` : state.view === 'summary' ? `
  <div class="seg small plan-switch" role="radiogroup" aria-label="Summary period">
    ${[['month', 'Month'], ['year', 'Year']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${sumMode() === v}" class="${sumMode() === v ? 'on' : ''}" data-act="sum-mode" data-value="${v}">${l}</button>`).join('')}
  </div>` : ''

// Google Calendar order: Today ‹ › at fixed spots, then the title in a
// fixed-width box, so switching views or months never moves the arrows.
const periodNav = () => hasPeriod() ? `
  <div class="period">
    <button class="btn soft small" data-act="today">${state.view === 'summary' ? (sumMode() === 'year' ? 'This year' : 'This month') : 'Today'}</button>
    <button class="icon-btn" data-act="prev" aria-label="Previous">${icon('left')}</button>
    <button class="icon-btn" data-act="next" aria-label="Next">${icon('right')}</button>
  </div>` : ''
const periodTools = () => state.view === 'week'
  ? `<button class="icon-btn" data-act="print" title="Print or save this week as PDF" aria-label="Print week">${icon('printer', 18)}</button>`
  : state.view === 'summary' ? `<button class="icon-btn" data-act="print" title="Print or save this summary as PDF" aria-label="Print summary">${icon('printer', 18)}</button>
      <button class="btn soft small report-btn" data-act="report" title="A Markdown report for a day or range">${icon('doc', 15)} Make report</button>` : ''

// Values stay all / pv / off in prefs.production; only the words changed.
const LAYERS = [['all', 'Full plan'], ['pv', 'R&D work'], ['off', 'My tasks']]
const layerToggle = () => isPlan(state.view) ? `
  <div class="seg small" title="What the calendar shows">
    ${LAYERS.map(([v, l]) => `<button type="button" class="${state.prefs.production === v ? 'on' : ''}" data-act="layer" data-value="${v}">${l}</button>`).join('')}
  </div>` : ''

function syncButton(compact) {
  const run = state.lastRun
  const failed = run?.ok === false
  return `<button class="sync-btn${state.syncing ? ' spinning' : ''}${failed ? ' failed' : ''}" data-act="sync" title="${esc(syncSummary(run))}" ${state.syncing ? 'disabled' : ''}>
    ${icon('sync', 16)}${compact ? '' : `<span>${state.syncing ? 'Syncing…' : failed ? 'Sync failed' : run ? `Synced ${timeAgo(run.finished_at || run.started_at)}` : 'Sync plan'}</span>`}
  </button>`
}

// The round « handle on the sidebar's right edge; collapsed = a 56px icon strip.
const sideHandle = () => `<button type="button" class="sb-handle" data-act="collapse" aria-label="${state.prefs.collapsed ? 'Show' : 'Hide'} sidebar" title="${state.prefs.collapsed ? 'Show' : 'Hide'} sidebar  ( \\ )">${icon('dleft', 16)}</button>`

// Pin calendar to desktop: a real on/off state (main.cjs tells us when the
// widget opens or closes, including from its own ✕).
const pinButton = () => !window.electronAPI?.widget ? '' : state.widgetOpen
  ? `<button class="sync-btn pin-btn pin-on" data-act="widget" title="The calendar is on your desktop. Click to close it.">${icon('pin', 16)}<span>Calendar pinned</span><em>${icon('check', 13)}on</em></button>`
  : `<button class="sync-btn pin-btn" data-act="widget" title="Open the calendar widget on your desktop">${icon('pin', 16)}<span>Pin calendar to desktop</span></button>`

const viewBar = () => readOnly ? `
  <div class="view-bar">${icon('eye', 16)}<span><b>View mode</b> — nothing can be changed here</span><button type="button" class="link" data-act="leave-view">Open full app</button></div>` : ''

function desktopShell() {
  const c = counts()
  const badge = { plan: c.overdue || '' }
  const collapsed = state.prefs.collapsed
  return `
    <div class="shell desktop${collapsed ? ' collapsed' : ''}">
      <aside class="sidebar">
        <div class="sb-top">
          <div class="brand"><img class="logo" src="./favicon.svg" alt=""><span>WorkLog</span><button class="new-sq" data-act="new" title="New task  (N)" aria-label="New task">${icon('plus', 18)}</button></div>
          <nav>
            ${NAV.map(n => `<button class="nav-item${navOn(n.view) ? ' on' : ''}" data-act="nav" data-view="${n.view}"${collapsed ? ` title="${n.label}${n.key ? `  (${n.key})` : ''}" aria-label="${n.label}"` : ''}>${icon(n.icon, 18)}<span>${n.label}</span>${badge[n.view] ? `<b class="nav-badge${n.view === 'plan' ? ' red' : ''}">${badge[n.view]}</b>` : ''}</button>`).join('')}
          </nav>
          ${miniMonth()}
        </div>
        <div class="sb-scroll">
          ${attention()}
          ${sideAgenda()}
        </div>
        <div class="sidebar-foot">
          ${pinButton()}
          ${syncButton(false)}<p class="version">v${__APP_VERSION__} · Alex Kim</p>
        </div>
      </aside>
      ${sideHandle()}
      <main class="main">
        ${viewBar()}
        <header class="topbar">
          ${periodNav()}
          <h1${hasPeriod() ? ' class="fixed"' : ''}>${esc(viewTitle())}</h1>
          <div class="topbar-right">
            ${layerToggle()}
            ${periodTools()}
            <label class="search-box">${icon('search', 16)}<input type="search" id="search-input" placeholder="Search  /" value="${esc(state.search)}" autocomplete="off"></label>
            ${planSwitch()}
          </div>
        </header>
        ${changeStrip()}
        <div class="content view-${state.view}">${content()}</div>
      </main>
    </div>`
}

// ── Sidebar: mini month, today + tomorrow, plan changes ──
const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const monthTitleOf = d => new Date(d + 'T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
function miniMonth() {
  const base = state.miniCursor || state.cursor || today()
  const first = monthStart(base)
  const start = weekStart(first)
  const weeks = addDays(start, 35).slice(0, 7) === first.slice(0, 7) ? 6 : 5
  const t = today()
  const wk = state.view === 'week' ? weekStart(state.cursor) : null
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)).map(d => {
    const colors = [...new Set(itemsOn(d).map(x => x.section || 'rd'))].slice(0, 3)
    const cls = ['md', d.slice(0, 7) !== first.slice(0, 7) && 'out', d === t && 'is-today', wk && d >= wk && d <= addDays(wk, 6) && 'in-range'].filter(Boolean).join(' ')
    return `<button type="button" class="${cls}" data-act="mini-day" data-date="${d}" aria-label="${esc(shortDate(d))}">${dayNum(d)}${colors.length && d !== t ? `<span class="dots">${colors.map(k => `<i style="--c:${deptColorOf(k)}"></i>`).join('')}</span>` : ''}</button>`
  }).join('')
  return `
    <div class="mini">
      <div class="mini-h"><b>${esc(monthTitleOf(first))}</b><span><button type="button" class="icon-btn small" data-act="mini-prev" aria-label="Previous month">${icon('left', 15)}</button><button type="button" class="icon-btn small" data-act="mini-next" aria-label="Next month">${icon('right', 15)}</button></span></div>
      <div class="mini-grid">${WD1.map(w => `<span class="wd">${w}</span>`).join('')}${cells}</div>
    </div>`
}

// Two days, by their real dates. Undated tasks fold in under them.
function sideAgenda() {
  const t = today()
  const undated = state.tasks.filter(x => isTracked(x) && !x.due_date && isOpen(x)).sort(byImportance)
  return `<div class="agenda">${[t, addDays(t, 1)].map(d => {
    const items = itemsOn(d)
    return `<div class="ag-day"><h5 class="${d === t ? 'now' : ''}"><span>${esc(relDay(d))}</span><span>${relHint(d)}</span></h5>
      ${items.length ? items.map(agendaItem).join('') : `<p class="ag-none">${isWeekend(d) ? 'Weekend' : 'Nothing for R&amp;D'}</p>`}</div>`
  }).join('')}
  ${undated.length ? `<details class="ag-undated"><summary>No date <b>${undated.length}</b></summary>${undated.map(agendaItem).join('')}</details>` : ''}</div>`
}

// Needs attention: overdue, clashes in the next 14 days, plan changes.
// Shown only when something is in it — in the sidebar on desktop, as a
// fold at the top of the agenda on the phone.
function attentionParts() {
  const overdue = state.tasks.filter(x => isTracked(x) && visible(x) && isOpen(x) && x.due_date && x.due_date < today()).sort((a, b) => a.due_date.localeCompare(b.due_date))
  const clashes = upcomingClashes(14).flatMap(({ d, clashes }) => clashes.map(c => ({ d, text: c.text })))
  const changes = [...marks().values()]
  const lots = groupChanges(changes)
  return { overdue, clashes, changes, lots, count: overdue.length + clashes.length + lots.length }
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// Desktop: a count and Show (the lots go on the calendar). Phone: one line
// per lot; tapping it starts the agenda at the lot's first new date.
function attentionBody({ overdue, clashes, changes, lots }, phone) {
  const lotRows = () => lots.map(g => `<button type="button" class="at-row" data-act="pday" data-date="${g.firstTo || ''}"><span><b>${esc(g.title)}${g.pv ? ` · ${g.pv}` : ''}</b><small>${esc(g.text)}</small></span></button>`).join('')
  const showRow = () => `<button type="button" class="at-row chg-row${state.showChanges ? ' on' : ''}" data-act="show-changes" aria-pressed="${!!state.showChanges}"><span><b>${plural(lots.length, 'lot')} changed</b><small>${plural(changes.length, 'step')} moved or new</small></span><em>${state.showChanges ? 'Hide' : 'Show'}</em></button>`
  return [
    overdue.length ? `<div class="at-group at-late"><h6>Overdue</h6>${overdue.map(x => `<div class="at-row" data-act="open" data-id="${x.id}" data-pop="${x.id}">${statusButtonOf(x)}<span><b>${esc(plainName(x))}</b><small>${esc(relDay(x.due_date))} · ${esc(relHint(x.due_date))}</small></span></div>`).join('')}</div>` : '',
    clashes.length ? `<div class="at-group at-clash"><h6>Clashes</h6>${clashes.map(c => `<button type="button" class="at-row" data-act="day" data-date="${c.d}"><span title="${esc(c.text)}"><b>${esc(relDay(c.d))}</b><small class="one">${esc(c.text)}</small></span></button>`).join('')}</div>` : '',
    lots.length ? `<div class="at-group at-change"><h6>Plan changes<button type="button" data-act="clear-changes">Clear all</button></h6>${phone ? lotRows() : showRow()}</div>` : '',
  ].join('')
}

// "Show changes": one card per product + lot above the calendar; each moved
// step also gets a ghost on its old day (activity.js ghostsOn). Clicking a
// card slides that lot's steps from old day to new and dims everything else.
const lotColor = g => { const t = state.tasks.find(x => g.ids.includes(x.id)); return deptColorOf(t?.section || 'rd') }
function changeStrip() {
  if (!state.showChanges || !isPlan(state.view)) return ''
  const lots = groupChanges([...marks().values()])
  if (!lots.length) return ''
  return `<div class="chg-strip"><b class="chg-label">Changes</b>${lots.map(g => `
    <button type="button" class="chg-lot${state.changeFocus === g.key ? ' on' : ''}" data-act="change-lot" data-value="${esc(g.key)}" style="--c:${lotColor(g)}" title="${esc(g.name)}: ${esc(g.text)}">
      <i></i><b>${esc(g.title)}${g.pv ? `<span class="tg">${g.pv}</span>` : ''}${g.lotShown ? `<em>Lot ${esc(g.lotShown)}</em>` : ''}</b><small>${esc(g.text)}</small>
    </button>`).join('')}<button type="button" class="chg-hide" data-act="show-changes">Hide changes${icon('x', 14)}</button></div>`
}
function attention() {
  const parts = attentionParts()
  if (!parts.count) return '<div class="attn" hidden></div>'
  return `<div class="attn"><h5>Needs attention <b>${parts.count}</b></h5><div class="attn-body">${attentionBody(parts)}</div></div>`
}
function phoneAttention() {
  const parts = attentionParts()
  if (!parts.count) return ''
  const sum = [parts.overdue.length && `${parts.overdue.length} overdue`, parts.clashes.length && `${parts.clashes.length} clash${parts.clashes.length > 1 ? 'es' : ''}`, parts.lots.length && `${plural(parts.lots.length, 'lot')} changed`].filter(Boolean).join(' · ')
  return `<details class="pattn"${state.attnOpen ? ' open' : ''}><summary>${icon('alert', 16)}<span>${sum}</span>${icon('down', 16)}</summary><div class="attn-body">${attentionBody(parts, true)}</div></details>`
}


function phoneShell() {
  const c = counts()
  const tabs = [
    { view: 'plan', label: 'Plan', icon: 'week', also: PLAN, badge: c.overdue },
    { view: 'lots', label: 'PV lots', icon: 'flask' },
    { add: true },
    { view: 'summary', label: 'Summary', icon: 'chart' },
    { view: 'settings', label: 'More', icon: 'more', also: ['search'] },
  ]
  return `
    <div class="shell phone">
      ${viewBar()}
      <header class="phone-top">
        ${isPlan(state.view) ? `<button type="button" class="ptitle${state.phoneMonth ? ' open' : ''}" data-act="phone-month" aria-expanded="${!!state.phoneMonth}">${esc(phoneTitle())}${icon('down', 18)}</button>` : `<h1>${esc(viewTitle())}</h1>`}
        <div class="phone-top-right">
          ${hasPeriod() ? `<button class="icon-btn" data-act="prev" aria-label="Previous">${icon('left')}</button><button class="icon-btn" data-act="next" aria-label="Next">${icon('right')}</button>` : ''}
          ${state.view !== 'search' ? `<button class="icon-btn" data-act="nav" data-view="search" aria-label="Search">${icon('search')}</button>` : ''}
          ${syncButton(true)}
        </div>
      </header>
      ${isPlan(state.view) ? `<div class="phone-sub">${layerToggle()}<button class="btn soft small" data-act="today">Today</button></div>` : ''}
      ${state.view === 'summary' ? `<div class="phone-sub">${planSwitch()}<button class="btn soft small" data-act="report">${icon('doc', 15)} Report</button></div>` : ''}
      <main class="content view-${state.view}">${isPlan(state.view) ? phoneAttention() : ''}${content()}</main>
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
  resetMarks()
  const active = document.activeElement
  const searchFocused = active?.id === 'search-input'
  const caret = searchFocused ? active.selectionStart : null
  const scroller = root.querySelector('.content')
  const scroll = scroller && lastShell === state.view ? scroller.scrollTop : 0
  root.innerHTML = isPhone() ? phoneShell() : desktopShell()
  lastShell = state.view
  decorateFocus()
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
  state.miniCursor = null
  if (state.view === 'summary') moveSummary(dir)
  else if (isPlan(state.view) && isPhone() && state.phoneMonth) state.cursor = addMonths(state.cursor, dir)
  else if (state.view === 'week') state.cursor = addDays(state.cursor, 7 * dir)
  else if (state.view === 'month') { state.cursor = addMonths(state.cursor, dir); state.selected = state.cursor.slice(0, 7) === today().slice(0, 7) ? today() : state.cursor }
  render()
}

// ── Interaction (one delegated handler) ──────────────────────────────────
// View mode (the LINE card's link, ?view=1): looking only.
const VIEW_BLOCKED = new Set(['new', 'cycle', 'del-note', 'digest-daily', 'digest-weekend', 'digest-test', 'test-line', 'line', 'login', 'clear-changes', 'view-make', 'view-off', 'view-copy'])
// One tap: open → done, done → open. A past plan step reopens as in_progress
// (stored only; it reads "To do"), since pending would show as auto-done again.
const reopened = t => (isSheet(t) && t.due_date && t.due_date < today() ? 'in_progress' : 'pending')
const nextStatus = t => (t.auto_done || t.status === 'done' ? reopened(t) : t.status === 'deferred' ? 'pending' : 'done')

async function cycleStatus(id) {
  const t = state.tasks.find(x => x.id === id)
  if (!t || isProduction(t)) return
  const prev = t.status
  const before = snapshot(t, { status: null }) // an auto-done step is 'pending' in the database
  const wasAuto = t.auto_done
  t.status = nextStatus(t)
  delete t.auto_done
  render()
  try {
    const next = { status: t.status }
    putTask(await updateTask(id, next))
    cacheData()
    render()
    const label = next.status === 'done' ? 'Done' : 'To do'
    const entry = recordUpdate(`${nameOf(t)} → ${label}`, id, before, next)
    if (next.status === 'done') toast('Done ✓', { label: 'Undo', run: () => undoIf(entry) })
  } catch (e) { t.status = prev; if (wasAuto) t.auto_done = true; render(); toast(e.message) }
}

async function onClick(e) {
  const el = e.target.closest('[data-act]')
  if (!el || !e.currentTarget.contains(el)) return
  const { act, id, view, date, value } = el.dataset
  if (act !== 'open' && act !== 'select') e.stopPropagation()
  if (readOnly && VIEW_BLOCKED.has(act)) return toast('View mode — open the full app to change things')
  switch (act) {
    case 'leave-view': return leaveViewMode()
    case 'view-make': {
      const next = { token: newToken(), made: new Date().toISOString() }
      try { await setSetting('view_link', next); state.viewLink = next; toast(value === 'new' ? 'New link made — the old one stopped working' : 'View link made'); render() } catch (err) { toast(err.message) }
      return
    }
    case 'view-off':
      try { await setSetting('view_link', {}); state.viewLink = {}; toast('View link switched off'); render() } catch (err) { toast(err.message) }
      return
    case 'view-copy':
      navigator.clipboard.writeText(`${WEB_URL}/?v=${state.viewLink?.token}`).then(() => toast('Link copied'), () => toast('Couldn’t copy'))
      return
    case 'digest-daily':
    case 'digest-weekend': {
      const next = { daily: true, weekend: true, ...(state.digest || {}), [act === 'digest-daily' ? 'daily' : 'weekend']: value === 'on' }
      const prev = state.digest
      state.digest = next
      render()
      try { await setSetting('digest', next) } catch (err) { state.digest = prev; render(); toast(err.message) }
      return
    }
    case 'digest-test':
      el.disabled = true
      try { const r = await postDigest('test'); toast(r.sent ? 'Sent today’s digest — check LINE' : r.reason || 'Not sent') } catch (err) { toast(err.message) }
      el.disabled = false
      return
    case 'nav': return setView(view)
    case 'new': return openEditor({ date: date || (state.view === 'month' ? state.selected : today()) }, render)
    case 'open': clearMark(root, id); return openEditor({ id }, render)
    case 'cycle': e.stopPropagation(); return cycleStatus(id)
    case 'prev': return move(-1)
    case 'next': return move(1)
    case 'today': state.cursor = today(); state.selected = today(); state.sumCursor = today(); state.miniCursor = null; return render()
    case 'mini-prev':
    case 'mini-next': state.miniCursor = addMonths(monthStart(state.miniCursor || state.cursor), act === 'mini-next' ? 1 : -1); return render()
    case 'mini-day':
      state.cursor = date; state.selected = date; state.miniCursor = null
      if (!isPlan(state.view)) return setView('plan')
      render()
      if (state.view === 'month') openDay(date)
      return
    case 'pday': state.cursor = date; state.selected = date; return render()
    case 'phone-month': state.phoneMonth = !state.phoneMonth; return render()
    case 'week-prod': savePrefs({ weekProd: !state.prefs.weekProd }); return render()
    case 'sum-mode': savePrefs({ sumMode: value }); return render()
    case 'sum-month': savePrefs({ sumMode: 'month' }); state.sumCursor = date; return render()
    case 'sum-retry': retrySummary(); return render()
    case 'report': return openReport()
    case 'select':
      state.selected = date
      return openDay(date)
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
    case 'clear-changes': clearChanges(); state.showChanges = false; state.changeFocus = null; return render()
    case 'show-changes':
      state.showChanges = !state.showChanges
      state.changeFocus = null
      if (state.showChanges && !isPlan(state.view)) return setView('plan')
      return render()
    case 'change-lot': return focusLot(value)
    case 'change-alerts': savePrefs({ changeAlerts: value === 'on' }); if (value === 'on') askPermission(); return render()
    case 'widget': return window.electronAPI?.widget?.toggle()
    case 'pv-remind': savePrefs({ pvRemind: value === 'off' ? null : Number(value) }); if (value !== 'off') askPermission(); return render()
    case 'sound': savePrefs({ sound: value === 'on' }); if (value === 'on') playChime({ force: true }); return render()
    case 'test-sound': return playChime({ force: true })
    case 'test-notify':
      if (!(await askPermission())) return toast(canNotify() ? 'Notifications are blocked — allow them for WorkLog first' : 'Notifications aren’t available here')
      testNotification()
      return
    case 'sync': return viewToken ? load() : sync()
    case 'export': return exportCsv(state.tasks)
    case 'signout': if (readOnly) return leaveViewMode(); await signOut(); return
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

// ── Show changes: focus one lot ──
const onScreen = d => !!root.querySelector(`.mg-day[data-date="${d}"], .col-h[data-date="${d}"]`)
function focusLot(key) {
  if (state.changeFocus === key) { state.changeFocus = null; return render() }
  const g = groupChanges([...marks().values()]).find(x => x.key === key)
  if (!g) return
  state.changeFocus = key
  // bring the new dates on screen first (a lot can move by weeks)
  if (g.firstTo && !onScreen(g.firstTo)) { state.cursor = g.firstTo; state.selected = g.firstTo; state.miniCursor = null }
  render()
  slideLot(g)
}
// Everything outside the focused lot dims; its ghosts and steps stay lit.
function decorateFocus() {
  const content = root.querySelector('.shell.desktop .content')
  if (!content || !state.showChanges || !state.changeFocus) return
  const g = groupChanges([...marks().values()]).find(x => x.key === state.changeFocus)
  if (!g) { state.changeFocus = null; return }
  content.classList.add('chg-focus')
  for (const id of g.ids) content.querySelectorAll(`[data-id="${id}"], [data-ghost="${id}"]`).forEach(e => e.classList.add('chg-hot'))
}
// A copy of each moved step flies from its ghost (old day) to the real block
// (new day), one after another, then the ring pulses. It plays even with
// reduced motion on (Alex's call: short, and only on a click). A step with
// no ghost on screen just pulses.
async function slideLot(g) {
  const content = root.querySelector('.shell.desktop .content')
  if (!content) return
  const real = id => content.querySelector(`.ev[data-id="${id}"], .wcard[data-id="${id}"]`)
  const pulse = el => { el.classList.remove('chg-pulse'); void el.offsetWidth; el.classList.add('chg-pulse') }
  const moved = g.items.filter(c => c.kind === 'moved' && c.from).sort((a, b) => a.from.localeCompare(b.from))
  for (const c of moved) {
    const to = real(c.id), from = content.querySelector(`[data-ghost="${c.id}"]`)
    if (!to) continue
    if (!from) { pulse(to); continue }
    const a = from.getBoundingClientRect(), z = to.getBoundingClientRect()
    const fly = to.cloneNode(true)
    fly.querySelector('.mk')?.remove()
    fly.classList.add('chg-fly')
    fly.removeAttribute('data-act'); fly.removeAttribute('data-pop'); fly.removeAttribute('data-id')
    Object.assign(fly.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` })
    document.body.appendChild(fly)
    to.style.visibility = 'hidden'
    const dx = z.left - a.left, dy = z.top - a.top
    // land once, whichever comes first: the animation ends, or 1 s passes
    // (a hidden window never ticks the animation clock)
    const land = () => { if (!fly.isConnected) return; fly.remove(); to.style.visibility = ''; pulse(to) }
    fly.animate([
      { transform: 'translate(0, 0) scale(1)', width: `${a.width}px`, height: `${a.height}px` },
      { transform: `translate(${dx / 2}px, ${dy / 2 - 24}px) scale(1.06)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, width: `${z.width}px`, height: `${z.height}px` },
    ], { duration: 640, easing: 'cubic-bezier(.3,.7,.25,1)' }).finished.then(land, land)
    setTimeout(land, 1000)
    await new Promise(r => setTimeout(r, 170))
  }
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
  if (readOnly) { e.preventDefault(); return }
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
  if (e.key === 'Escape') { if (closeTopModal()) return; if (state.view === 'search') { state.search = ''; setView('plan') } return }
  const k = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y') && state.member) {
    if (textEntry(e.target) || readOnly) return
    e.preventDefault()
    if (k === 'y' || e.shiftKey) redo(); else undo()
    return
  }
  const typing = e.target.closest('input, textarea, select, [contenteditable]')
  if (typing || modalOpen() || e.ctrlKey || e.metaKey || e.altKey || !state.member) return
  if (readOnly && e.key.toLowerCase() === 'n') return
  const keys = {
    n: () => openEditor({ date: state.view === 'month' ? state.selected : today() }, render),
    t: () => { state.cursor = today(); state.selected = today(); render() },
    '1': () => setView('week'), '2': () => setView('month'), '3': () => setView('lots'), '4': () => setView('summary'),
    '/': () => root.querySelector('#search-input')?.focus() ?? setView('search'),
    '\\': () => { if (!isPhone()) toggleCollapsed() },
    ArrowLeft: () => move(-1), ArrowRight: () => move(1),
  }
  const fn = keys[e.key]
  if (fn) { e.preventDefault(); fn() }
})

// iOS ignores user-scalable=no; block pinch zoom like Coin does.
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, e => e.preventDefault(), { passive: false })
// Brave, Chrome and LINE's in-app browser ignore user-scalable=no: stop a
// two-finger move from zooming (CSS touch-action covers double-tap).
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })

// Pin button state: ask once, then main.cjs reports every open/close.
const refreshPin = open => { state.widgetOpen = !!open; const b = root.querySelector('.pin-btn'); if (b) b.outerHTML = pinButton() }
window.electronAPI?.widget?.getState?.().then(s => refreshPin(s?.open)).catch(() => {})
window.electronAPI?.widget?.onChange?.(refreshPin)
window.electronAPI?.login?.get().then(v => { if (v != null) { state.loginOpen = v; if (state.view === 'settings') render() } }).catch(() => {})
initUpdateReload({ isBusy: modalOpen })
initPopover(root)
// a ring cleared by hovering: refresh the sidebar's change list in place
root.addEventListener('toggle', e => { if (e.target.classList?.contains('pattn')) state.attnOpen = e.target.open }, true)
root.addEventListener('marks-changed', () => { const box = root.querySelector('.attn'); if (box) box.outerHTML = attention() })
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
