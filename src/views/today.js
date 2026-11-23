import { state, counts, dayContent, isTracked, isOpen, isOverdue, visible, byImportance, startOf } from '../store.js'
import { today, addDays, longDate, relDay } from '../dates.js'
import { taskRow, productionBlock, empty, noteList } from '../components.js'
import { esc, icon } from '../ui.js'
import { upcomingReminders, whenLabel } from '../reminders.js'
import { loadChanges, changeText } from '../planChanges.js'
import { upcomingClashes } from '../clashes.js'
import { weekday, shortDate } from '../dates.js'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const section = (title, body, { tone = '', action = '' } = {}) => body ? `
  <section class="card ${tone}">
    <header class="card-head"><h2>${title}</h2>${action}</header>
    ${body}
  </section>` : ''

export function renderToday() {
  const t = today()
  const c = counts()
  const { mine, production, notes } = dayContent(t)
  const mineToday = mine.filter(x => !isOverdue(x))
  const overdue = state.tasks.filter(x => isOverdue(x) && visible(x)).sort(byImportance)

  // Next 7 days, grouped by day — only your stuff, production stays on Week.
  const upcoming = []
  for (let i = 1; i <= 7; i++) {
    const d = addDays(t, i)
    const items = state.tasks.filter(x => isTracked(x) && visible(x) && x.due_date === d && isOpen(x)).sort(byImportance)
    if (items.length) upcoming.push({ d, items })
  }
  const undated = state.tasks.filter(x => isTracked(x) && !x.due_date && isOpen(x))
  const doneToday = mine.filter(x => x.status === 'done').length

  const stat = (n, label, tone) => `<div class="stat ${tone}"><b>${n}</b><span>${label}</span></div>`

  return `
    <div class="today">
      <section class="hero">
        <div class="hero-text">
          <p class="hero-date">${esc(longDate(t))}</p>
          <h1>${greeting()} 👋</h1>
          <p class="hero-sub">${heroLine(c, doneToday)}</p>
        </div>
        <div class="stats">
          ${stat(c.today, 'today', 'violet')}
          ${stat(c.overdue, 'overdue', c.overdue ? 'red' : 'mint')}
          ${stat(c.week, 'this week', 'amber')}
          ${stat(c.production, 'production', 'blue')}
        </div>
      </section>

      <div class="today-grid">
        <div class="col">
          ${section(`${icon('alert', 18)} Overdue`, overdue.length ? `<div class="list">${overdue.map(x => taskRow(x)).join('')}</div>` : '', { tone: 'tone-red' })}
          ${section(`${icon('sun', 18)} Today`,
            mineToday.length ? `<div class="list">${mineToday.map(x => taskRow(x, { showDate: false })).join('')}</div>`
              : empty('Nothing planned for today. Add something, or enjoy it.', '☀️'),
            { action: `<button class="btn soft small" data-act="new" data-date="${t}">${icon('plus', 16)} Add</button>` })}
          ${section(`${icon('clock', 18)} Coming up`, upcoming.map(({ d, items }) => `
            <div class="day-group"><div class="day-label">${esc(relDay(d))}</div><div class="list">${items.map(x => taskRow(x, { showDate: false })).join('')}</div></div>`).join(''))}
          ${section(`${icon('sparkle', 18)} No date`, undated.length ? `<div class="list">${undated.map(x => taskRow(x)).join('')}</div>` : '')}
        </div>
        <div class="col">
          ${section(`${icon('factory', 18)} Production today`,
            state.prefs.production === 'all'
              ? (production.length ? productionBlock(production) : empty('No production on the plan today.', '🏭'))
              : `<p class="muted">Production layer is ${state.prefs.production === 'pv' ? 'set to PV + R&D line only' : 'hidden'}. <button class="link" data-act="layer" data-value="all">Show all</button></p>`)}
          ${clashList()}
          ${changeList()}
          ${section(`${icon('bell', 18)} Reminders`, reminderList(), { action: `<button class="link small" data-act="nav" data-view="settings">Settings</button>` })}
          ${section(`${icon('note', 18)} Notes`, noteList(notes, t))}
        </div>
      </div>
    </div>`
}

function heroLine(c, doneToday) {
  if (c.overdue) return `${c.overdue} thing${c.overdue > 1 ? 's' : ''} slipped — let's catch up.`
  if (c.today === 0 && doneToday) return `All done for today. Nice work ✨`
  if (c.today === 0) return `A clear day. ${c.production ? `${c.production} production runs on the floor.` : ''}`
  return `${c.today} on your plate today${doneToday ? `, ${doneToday} already done` : ''}.`
}

// Next two weeks of reminders (PV steps by default + anything you set).
function reminderList() {
  const items = upcomingReminders(14).slice(0, 8)
  if (!items.length) return `<p class="muted small">No reminders in the next two weeks. Open a task and pick <b>Remind me</b>${state.prefs.pvRemind == null ? ', or switch on PV reminders in Settings' : ''}.</p>`
  return `<div class="reminders">${items.map(({ task, at, r }) => `
    <button type="button" class="reminder" data-act="open" data-id="${task.id}" style="--c:${task.type === 'pv_lot' ? 'var(--accent)' : 'var(--amber)'}">
      <span class="rem-when">${esc(whenLabel(at))}</span>
      <span class="rem-what">${esc(task.source === 'sheet' ? (task.product_name || task.title) : task.title)}</span>
      <span class="rem-meta">${esc([task.step, relDay(startOf(task))].filter(Boolean).join(' · '))}${r.auto ? ' · PV' : ''}</span>
    </button>`).join('')}</div>`
}

// Days in the next two weeks where R&D is needed in two places (clashes.js).
function clashList() {
  const days = upcomingClashes(14)
  if (!days.length) return ''
  return section(`${icon('alert', 18)} Clashes ahead`, `<div class="clashes">${days.flatMap(({ d, clashes }) => clashes.map(c => `
    <button type="button" class="clash-line" data-act="day" data-date="${d}">
      <span class="cl-day">${esc(relDay(d) === 'Today' || relDay(d) === 'Tomorrow' ? relDay(d) : `${weekday(d)} ${shortDate(d)}`)}</span>
      <span class="cl-what">${esc(c.text)}</span>
    </button>`)).join('')}</div>`, { tone: 'tone-amber' })
}

// PV / R&D-line steps the sheet moved since you last looked.
function changeList() {
  const changes = loadChanges()
  if (!changes.length) return ''
  return section(`${icon('alert', 18)} Plan changes`, `<div class="changes">${changes.slice(0, 10).map(c => {
    const x = changeText(c)
    const tag = c.id ? `button type="button" data-act="open" data-id="${c.id}"` : 'div'
    return `<${tag} class="change k-${c.kind}"><span class="ch-what">${esc(c.name)}</span><span class="ch-how">${esc(x.how)}</span><span class="ch-when">${esc([c.step, `noticed ${relDay(c.at.slice(0, 10)).toLowerCase()}`].filter(Boolean).join(' · '))}</span></${tag.split(' ')[0]}>`
  }).join('')}</div>`, { tone: 'tone-amber', action: `<button class="link small" data-act="clear-changes">Clear</button>` })
}
