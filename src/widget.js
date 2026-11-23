// The pinned calendar widget (desktop only): a small frameless window that
// sits on the desktop. It shares localStorage with the main window, so it reads
// the same cached plan and prefs and redraws whenever the main window saves
// new data (the 'storage' event); it also refetches on its own now and then.
// Week | Month switch in the title bar; below ~300×260 the pills turn into
// dots (CSS), so it still reads at taskbar-thumbnail size.
import { state, restoreCache, groupByDept, dayContent, isTracked, isOpen, visible, byImportance, startOf, onDay, isRdLine } from './store.js'
import { getSession, fetchTasks, fetchNotes } from './data.js'
import { isConfigured } from './config.js'
import { today, addDays, addMonths, weekStart, monthStart, dayNum, isWeekend, relDay, fromStr, shortDate } from './dates.js'
import { deptColor } from './components.js'
import { reminderFor } from './reminders.js'
import { esc, icon } from './ui.js'
import { applyTheme } from './theme.js'
import { dayClashes } from './clashes.js'

const root = document.getElementById('app')
const api = window.electronAPI?.widget
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
let cursor = today()
let onTop = false

// Widget-only settings live under their own key: the main window rewrites
// wl_prefs from its own copy, which would drop anything set here.
const WG_KEY = 'wl_widget'
const wg = (() => { try { return { mode: 'month', nextOpen: true, ...JSON.parse(localStorage.getItem(WG_KEY) || '{}') } } catch { return { mode: 'month', nextOpen: true } } })()
const saveWg = patch => { Object.assign(wg, patch); try { localStorage.setItem(WG_KEY, JSON.stringify(wg)) } catch {} }

function reloadPrefs() {
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem('wl_prefs') || '{}')) } catch {}
  applyTheme(state.prefs.theme)
}

const label = x => (x.source === 'sheet' ? (x.product_name || x.title) : x.title)
const pillColor = x => x.type === 'pv_lot' ? 'var(--accent)' : deptColor(x.section || 'rd')

// R&D is involved: your own tasks, PV steps, or a run on the R&D line —
// whatever the production layer setting hides.
const hasRd = d => state.tasks.some(t => onDay(t, d) && !state.prefs.hiddenDepts.includes(t.section || 'other') && (isTracked(t) || isRdLine(t)))

function cell(d, { month, t, max }) {
  const { mine, production } = dayContent(d)
  const groups = groupByDept(production)
  const clash = dayClashes(d).length > 0
  const cls = ['wg-day', month && d.slice(0, 7) !== month && 'out', d === t && 'is-today', isWeekend(d) && 'weekend', hasRd(d) && 'has-rd', clash && 'clash'].filter(Boolean).join(' ')
  const tip = [...(clash ? ['⚠ Clash — see WorkLog'] : []), ...mine.map(label), ...groups.map(g => `${g.dept.label} ${g.tasks.length}`)].join('\n')
  return `
    <button type="button" class="${cls}" data-date="${d}" title="${esc(tip)}">
      <span class="wg-num">${dayNum(d)}${clash ? '<b class="wg-clash" aria-label="Clash">!</b>' : ''}</span>
      <span class="wg-pills">${mine.slice(0, max).map(x => `<i class="s-${x.status}" style="--c:${pillColor(x)}">${esc(label(x))}</i>`).join('')}${mine.length > max ? `<i class="more">+${mine.length - max}</i>` : ''}</span>
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
    <button type="button" class="wg-item" data-id="${x.id}" style="--c:${pillColor(x)}">
      <span class="wg-when">${esc(relDay(startOf(x) < t ? t : startOf(x)))}</span>
      <span class="wg-what">${esc(label(x))}${x.step ? ` <em>${esc(x.step)}</em>` : ''}</span>
      ${reminderFor(x) ? `<span class="wg-bell">${icon('bell', 12)}</span>` : ''}
    </button>`).join('')
}

function title() {
  if (wg.mode === 'week') {
    const s = weekStart(cursor), e = addDays(s, 6)
    return s.slice(0, 7) === e.slice(0, 7) ? `${dayNum(s)}–${shortDate(e)}` : `${shortDate(s)} – ${shortDate(e)}`
  }
  return `${fromStr(cursor).toLocaleString('en-GB', { month: 'long' })}${cursor.slice(0, 4) !== today().slice(0, 4) ? ` ${cursor.slice(0, 4)}` : ''}`
}

function grid() {
  const t = today()
  if (wg.mode === 'week') {
    const s = weekStart(cursor)
    const days = Array.from({ length: 7 }, (_, i) => addDays(s, i))
    return `
      <div class="wg-grid week" style="--rows:1">
        ${days.map((d, i) => `<span class="wg-wd">${WEEKDAYS[i]}</span>`).join('')}
        ${days.map(d => cell(d, { t, max: 6 })).join('')}
      </div>`
  }
  const first = monthStart(cursor)
  const month = first.slice(0, 7)
  const start = weekStart(first)
  const weeks = addDays(start, 35).slice(0, 7) === month ? 6 : 5
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  return `
    <div class="wg-grid" style="--rows:${weeks}">
      ${WEEKDAYS.map(w => `<span class="wg-wd">${w}</span>`).join('')}
      ${days.map(d => cell(d, { month, t, max: 2 })).join('')}
    </div>`
}

function render() {
  const week = wg.mode === 'week'
  root.innerHTML = `
    <div class="widget">
      <header class="wg-bar">
        <img class="logo wg-logo" src="./favicon.svg" alt="">
        <div class="seg small wg-mode" role="radiogroup" aria-label="Widget view">
          <button type="button" role="radio" aria-checked="${week}" class="${week ? 'on' : ''}" data-act="mode" data-value="week" title="Week"><b>W</b><span>eek</span></button>
          <button type="button" role="radio" aria-checked="${!week}" class="${week ? '' : 'on'}" data-act="mode" data-value="month" title="Month"><b>M</b><span>onth</span></button>
        </div>
        <b class="wg-title">${esc(title())}</b>
        <div class="wg-btns">
          <button class="icon-btn small" data-act="prev" aria-label="Previous ${week ? 'week' : 'month'}">${icon('left', 16)}</button>
          <button class="icon-btn small wg-today" data-act="today" title="${week ? 'This week' : 'This month'}">•</button>
          <button class="icon-btn small" data-act="next" aria-label="Next ${week ? 'week' : 'month'}">${icon('right', 16)}</button>
          <span class="wg-sep"></span>
          <button class="icon-btn small${onTop ? ' on' : ''}" data-act="pin" title="${onTop ? 'Pinned on top — click to let other windows cover it' : 'Keep on top of other windows'}" aria-pressed="${onTop}">${icon('pin', 15)}</button>
          <button class="icon-btn small wg-open" data-act="main" title="Open WorkLog">${icon('external', 15)}</button>
          <button class="icon-btn small" data-act="close" title="Close widget">${icon('x', 15)}</button>
        </div>
      </header>
      ${state.loaded ? `
        ${grid()}
        <div class="wg-next${wg.nextOpen ? '' : ' closed'}">
          <button type="button" class="wg-h" data-act="next-toggle" aria-expanded="${wg.nextOpen}">${icon(wg.nextOpen ? 'down' : 'right', 12)} Next 7 days</button>
          ${wg.nextOpen ? nextUp() : ''}
        </div>`
        : `<p class="wg-empty">Open WorkLog and sign in — the calendar appears here.</p>`}
    </div>`
}

root.addEventListener('click', e => {
  const el = e.target.closest('button')
  if (!el) return
  const { act, date, id, value } = el.dataset
  const step = n => (wg.mode === 'week' ? addDays(cursor, 7 * n) : addMonths(cursor, n))
  if (act === 'mode') { saveWg({ mode: value }); cursor = today(); return render() }
  if (act === 'prev') { cursor = step(-1); return render() }
  if (act === 'next') { cursor = step(1); return render() }
  if (act === 'today') { cursor = today(); return render() }
  if (act === 'next-toggle') { saveWg({ nextOpen: !wg.nextOpen }); return render() }
  if (act === 'pin') { onTop = !onTop; api?.setOnTop(onTop); return render() }
  if (act === 'main') return api?.openMain({})
  if (act === 'close') return api?.close()
  if (date) return api?.openMain({ view: wg.mode === 'week' ? 'week' : 'month', date })
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
