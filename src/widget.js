// The pinned month widget (desktop only): a small frameless window that sits
// on the desktop. It shares localStorage with the main window, so it reads the
// same cached plan and prefs and redraws whenever the main window saves new
// data (the 'storage' event); it also refetches on its own now and then.
import { state, restoreCache, groupByDept, dayContent, isTracked, isOpen, visible, byImportance, startOf } from './store.js'
import { getSession, fetchTasks, fetchNotes } from './data.js'
import { isConfigured } from './config.js'
import { today, addDays, addMonths, weekStart, monthStart, dayNum, isWeekend, relDay, fromStr } from './dates.js'
import { deptColor } from './components.js'
import { reminderFor } from './reminders.js'
import { esc, icon } from './ui.js'
import { applyTheme } from './theme.js'

const root = document.getElementById('app')
const api = window.electronAPI?.widget
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
let cursor = today()
let onTop = false

function reloadPrefs() {
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem('wl_prefs') || '{}')) } catch {}
  applyTheme(state.prefs.theme)
}

const label = x => (x.source === 'sheet' ? (x.product_name || x.title) : x.title)

function cell(d, month, t) {
  const { mine, production } = dayContent(d)
  const groups = groupByDept(production)
  const cls = ['wg-day', d.slice(0, 7) !== month && 'out', d === t && 'is-today', isWeekend(d) && 'weekend', mine.some(x => x.type === 'pv_lot') && 'has-pv'].filter(Boolean).join(' ')
  const tip = [...mine.map(label), ...groups.map(g => `${g.dept.label} ${g.tasks.length}`)].join('\n')
  return `
    <button type="button" class="${cls}" data-date="${d}" title="${esc(tip)}">
      <span class="wg-num">${dayNum(d)}</span>
      <span class="wg-pills">${mine.slice(0, 2).map(x => `<i class="s-${x.status}" style="--c:${x.type === 'pv_lot' ? 'var(--accent)' : deptColor(x.section || 'rd')}">${esc(label(x))}</i>`).join('')}${mine.length > 2 ? `<i class="more">+${mine.length - 2}</i>` : ''}</span>
      <span class="wg-prod">${groups.map(g => `<b style="--c:${g.dept.color};flex:${g.tasks.length}"></b>`).join('')}</span>
    </button>`
}

// Your open items (incl. PV steps) over the next week.
function nextUp() {
  const t = today()
  const until = addDays(t, 7)
  const items = state.tasks.filter(x => isTracked(x) && visible(x) && isOpen(x) && x.due_date && x.due_date >= t && startOf(x) <= until)
    .sort((a, b) => startOf(a).localeCompare(startOf(b)) || byImportance(a, b)).slice(0, 4)
  if (!items.length) return '<p class="wg-empty">Nothing of yours in the next 7 days.</p>'
  return items.map(x => `
    <button type="button" class="wg-item" data-id="${x.id}" style="--c:${x.type === 'pv_lot' ? 'var(--accent)' : deptColor(x.section || 'rd')}">
      <span class="wg-when">${esc(relDay(startOf(x) < t ? t : startOf(x)))}</span>
      <span class="wg-what">${esc(label(x))}${x.step ? ` <em>${esc(x.step)}</em>` : ''}</span>
      ${reminderFor(x) ? `<span class="wg-bell">${icon('bell', 12)}</span>` : ''}
    </button>`).join('')
}

function render() {
  const first = monthStart(cursor)
  const month = first.slice(0, 7)
  const start = weekStart(first)
  const t = today()
  const weeks = addDays(start, 35).slice(0, 7) === month ? 6 : 5
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  root.innerHTML = `
    <div class="widget">
      <header class="wg-bar">
        <img class="logo wg-logo" src="./favicon.svg" alt="">
        <b class="wg-title">${esc(fromStr(cursor).toLocaleString('en-GB', { month: 'long' }))}${cursor.slice(0, 4) !== today().slice(0, 4) ? ` ${cursor.slice(0, 4)}` : ''}</b>
        <div class="wg-btns">
          <button class="icon-btn small" data-act="prev" aria-label="Previous month">${icon('left', 16)}</button>
          <button class="icon-btn small wg-today" data-act="today" title="This month">•</button>
          <button class="icon-btn small" data-act="next" aria-label="Next month">${icon('right', 16)}</button>
          <span class="wg-sep"></span>
          <button class="icon-btn small${onTop ? ' on' : ''}" data-act="pin" title="${onTop ? 'Pinned on top — click to let other windows cover it' : 'Keep on top of other windows'}" aria-pressed="${onTop}">${icon('pin', 15)}</button>
          <button class="icon-btn small" data-act="main" title="Open WorkLog">${icon('external', 15)}</button>
          <button class="icon-btn small" data-act="close" title="Close widget">${icon('x', 15)}</button>
        </div>
      </header>
      ${state.loaded ? `
        <div class="wg-grid" style="--rows:${weeks}">
          ${WEEKDAYS.map(w => `<span class="wg-wd">${w}</span>`).join('')}
          ${days.map(d => cell(d, month, t)).join('')}
        </div>
        <div class="wg-next"><p class="wg-h">Next 7 days</p>${nextUp()}</div>`
        : `<p class="wg-empty">Open WorkLog and sign in — the calendar appears here.</p>`}
    </div>`
}

root.addEventListener('click', e => {
  const el = e.target.closest('button')
  if (!el) return
  const { act, date, id } = el.dataset
  if (act === 'prev') { cursor = addMonths(cursor, -1); return render() }
  if (act === 'next') { cursor = addMonths(cursor, 1); return render() }
  if (act === 'today') { cursor = today(); return render() }
  if (act === 'pin') { onTop = !onTop; api?.setOnTop(onTop); return render() }
  if (act === 'main') return api?.openMain({})
  if (act === 'close') return api?.close()
  if (date) return api?.openMain({ view: 'month', date })
  if (id) return api?.openMain({ id })
})

async function refetch() {
  if (!isConfigured() && import.meta.env.MODE !== 'demo') return
  try {
    if (!(await getSession())) return
    const [tasks, notes] = await Promise.all([fetchTasks(), fetchNotes()])
    Object.assign(state, { tasks, notes, loaded: true })
    render()
  } catch {} // offline: keep showing the cached plan
}

// The main window saved new data or prefs.
window.addEventListener('storage', e => {
  if (e.key === 'wl_cache') { restoreCache(); state.loaded = true }
  if (e.key === 'wl_prefs') reloadPrefs()
  if (e.key === 'wl_cache' || e.key === 'wl_prefs') render()
})

document.documentElement.classList.add('is-widget')
reloadPrefs()
state.loaded = restoreCache()
api?.getState().then(s => { onTop = !!s?.onTop; render() })
render()
refetch()
setInterval(refetch, 15 * 60_000)
setInterval(render, 5 * 60_000) // roll over at midnight
