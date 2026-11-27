import { state, dayContent, groupByDept } from '../store.js'
import { today, addDays, weekStart, monthStart, dayNum, monthYear, longDate, isWeekend } from '../dates.js'
import { taskRow, productionBlock, noteList, empty } from '../components.js'
import { esc, icon } from '../ui.js'
import { clashTitle, dayClashes } from '../clashes.js'
import { itemsOn, chip, ghostsOn, ghostChip } from '../activity.js'

export const monthTitle = () => monthYear(state.cursor)

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// One full-width grid. A cell shows the R&D activities (step · name · PV) in
// department colour and a thin production bar; hover a chip for the detail,
// click the day for everything on it.
export function renderMonth() {
  const first = monthStart(state.cursor)
  const month = first.slice(0, 7)
  const start = weekStart(first)
  const t = today()
  // 6 rows only when the month actually needs them.
  const weeks = addDays(start, 35).slice(0, 7) === month ? 6 : 5
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  const max = weeks === 6 ? 3 : 4
  return `
    <div class="month-grid" style="--rows:${weeks}">
      ${WEEKDAYS.map(w => `<div class="mg-wd">${w}</div>`).join('')}
      ${days.map(d => cell(d, month, t, max)).join('')}
    </div>`
}

function cell(d, month, t, max) {
  const { production, notes } = dayContent(d)
  const items = itemsOn(d)
  const ghosts = ghostsOn(d)
  const slots = Math.max(1, max - ghosts.length)
  const groups = groupByDept(production.filter(p => !items.includes(p)))
  const clash = clashTitle(d)
  const out = d.slice(0, 7) !== month
  const cls = ['mg-day', out && 'out', d === t && 'is-today', isWeekend(d) && 'weekend', clash && 'has-clash'].filter(Boolean).join(' ')
  const num = out && dayNum(d) === 1 ? new Date(d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : dayNum(d)
  return `
    <div class="${cls}" data-act="select" data-date="${d}" role="button" tabindex="0" aria-label="${esc(longDate(d))}${clash ? ', clash' : ''}">
      <div class="mg-num">${clash ? `<span class="clash-badge" title="Clash — ${esc(clash)}">!</span>` : ''}${notes.length ? `<span class="mg-note" title="${esc(notes.map(n => n.content).join(' · '))}">${icon('note', 12)}</span>` : ''}<b>${num}</b></div>
      ${ghosts.map(ghostChip).join('')}
      ${items.slice(0, slots).map(chip).join('')}
      ${items.length > slots ? `<span class="mg-more">+${items.length - slots} more</span>` : ''}
      ${groups.length ? `<div class="mg-prod" title="Production: ${groups.map(g => `${esc(g.dept.label)} ${g.tasks.length}`).join(', ')}">${groups.map(g => `<span class="bar" style="--c:${g.dept.color};flex:${g.tasks.length}"></span>`).join('')}</div>` : ''}
    </div>`
}

// A day in full (popup from the month grid or the mini calendar).
export function dayPanel(d) {
  const { mine, production, notes } = dayContent(d)
  return `
    <header class="dp-head">
      <div>
        <p class="eyebrow">${d === today() ? 'Today' : esc(new Date(d + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long' }))}</p>
        <h2>${esc(longDate(d).replace(/^\w+,?\s*/, ''))}</h2>
      </div>
      <button class="btn soft small" data-act="new" data-date="${d}">${icon('plus', 16)} Add</button>
    </header>
    ${dayClashes(d).map(c => `<p class="clash-note">${icon('alert', 15)} <b>Clash:</b> ${esc(c.text)}</p>`).join('')}
    ${mine.length ? `<div class="list">${mine.map(x => taskRow(x, { showDate: false })).join('')}</div>` : empty('Nothing of yours on this day.', '🌿')}
    ${production.length ? `<h3 class="sub">${icon('factory', 16)} Production</h3>${productionBlock(production)}` : ''}
    <h3 class="sub">${icon('note', 16)} Notes</h3>
    ${noteList(notes, d)}`
}
