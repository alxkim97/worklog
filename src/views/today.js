import { state, counts, dayContent, isTracked, isOpen, isOverdue, visible, byImportance } from '../store.js'
import { today, addDays, longDate, relDay } from '../dates.js'
import { taskRow, productionBlock, empty, noteList } from '../components.js'
import { esc, icon } from '../ui.js'

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
              : `<p class="muted">Production layer is ${state.prefs.production === 'pv' ? 'set to PV lots only' : 'hidden'}. <button class="link" data-act="layer" data-value="all">Show all</button></p>`)}
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
