import { state, dayContent, groupByDept } from '../store.js'
import { today, addDays, weekStart, monthStart, dayNum, monthYear, longDate, isWeekend } from '../dates.js'
import { taskRow, productionBlock, noteList, empty, deptColor } from '../components.js'
import { esc, icon } from '../ui.js'

export const monthTitle = () => monthYear(state.cursor)

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MAX_PILLS = 3

export function renderMonth() {
  const first = monthStart(state.cursor)
  const month = first.slice(0, 7)
  const start = weekStart(first)
  const t = today()
  // 6 rows only when the month actually needs them.
  const weeks = addDays(start, 35).slice(0, 7) === month ? 6 : 5
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))

  return `
    <div class="month">
      <div class="month-grid-wrap">
        <div class="month-grid" style="--rows:${weeks}">
          ${WEEKDAYS.map(w => `<div class="mg-wd">${w}</div>`).join('')}
          ${days.map(d => cell(d, month, t)).join('')}
        </div>
      </div>
      <aside class="day-panel">${dayPanel(state.selected)}</aside>
    </div>`
}

function cell(d, month, t) {
  const { mine, production, notes } = dayContent(d)
  const groups = groupByDept(production)
  const cls = ['mg-day', d.slice(0, 7) !== month && 'out', d === t && 'is-today', d === state.selected && 'sel', isWeekend(d) && 'weekend'].filter(Boolean).join(' ')
  return `
    <div class="${cls}" data-act="select" data-date="${d}" role="button" tabindex="0" aria-label="${esc(longDate(d))}">
      <div class="mg-num">${dayNum(d)}${notes.length ? `<span class="mg-note">${icon('note', 11)}</span>` : ''}</div>
      <div class="mg-pills">
        ${mine.slice(0, MAX_PILLS).map(x => `<div class="pill s-${x.status}" style="--c:${deptColor(x.section || 'rd')}">${esc(x.product_name && x.source === 'sheet' ? x.product_name : x.title)}</div>`).join('')}
        ${mine.length > MAX_PILLS ? `<div class="pill more">+${mine.length - MAX_PILLS} more</div>` : ''}
      </div>
      <div class="mg-prod" ${production.length ? `title="Production: ${groups.map(g => `${esc(g.dept.label)} ${g.tasks.length}`).join(', ')}"` : ''}>
        ${groups.map(g => `<span class="bar" style="--c:${g.dept.color};flex:${g.tasks.length}"></span>`).join('')}
      </div>
      <div class="mg-dots">
        ${mine.length ? '<i class="mine"></i>' : ''}${groups.map(g => `<i style="--c:${g.dept.color}"></i>`).join('')}
      </div>
    </div>`
}

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
    ${mine.length ? `<div class="list">${mine.map(x => taskRow(x, { showDate: false })).join('')}</div>` : empty('Nothing of yours on this day.', '🌿')}
    ${production.length ? `<h3 class="sub">${icon('factory', 16)} Production</h3>${productionBlock(production)}` : ''}
    <h3 class="sub">${icon('note', 16)} Notes</h3>
    ${noteList(notes, d)}`
}
