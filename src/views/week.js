import { state, dayContent } from '../store.js'
import { today, addDays, weekStart, weekday, dayNum, isWeekend, shortDate, fromStr } from '../dates.js'
import { taskRow, productionBlock, deptColor } from '../components.js'
import { esc, icon } from '../ui.js'

export function weekTitle() {
  const s = weekStart(state.cursor)
  const e = addDays(s, 6)
  // "23–29 Nov" in one month, "30 Nov – 6 Dec" across two
  if (s.slice(0, 7) === e.slice(0, 7)) return `${dayNum(s)}–${shortDate(e)}`
  return `${shortDate(s)} – ${shortDate(e)}`
}

// Desktop: seven columns. Phone: the same days stacked as an agenda (CSS).
export function renderWeek({ isPhone } = {}) {
  const s = weekStart(state.cursor)
  const t = today()
  const days = Array.from({ length: 7 }, (_, i) => addDays(s, i))
  const content = days.map(d => dayContent(d))
  const isEmpty = c => !c.mine.length && !c.production.length && !c.notes.length
  // Empty weekend days shrink to a narrow strip so the working days get the width.
  const cols = days.map((d, i) => isWeekend(d) && isEmpty(content[i]) ? 'minmax(64px, .32fr)' : 'minmax(0, 1fr)').join(' ')
  return `
    <div class="week" style="--week-cols:${cols}">
      ${days.map((d, i) => {
        const { mine, production, notes } = content[i]
        const weekend = isWeekend(d)
        const emptyDay = isEmpty(content[i])
        return `
          <section class="wday${d === t ? ' is-today' : ''}${weekend ? ' weekend' : ''}${emptyDay ? ' empty-day' : ''}">
            <header class="wday-head" data-act="day" data-date="${d}">
              <span class="wd">${esc(weekday(d))}</span>
              <span class="dn">${dayNum(d)}</span>
              <span class="wday-month">${esc(fromStr(d).toLocaleString('en-GB', { month: 'short' }))}</span>
              <button type="button" class="icon-btn small add-day" data-act="new" data-date="${d}" aria-label="Add on ${esc(shortDate(d))}">${icon('plus', 16)}</button>
            </header>
            <div class="wday-body">
              ${mine.length ? `<div class="list tight">${mine.map(x => taskRow(x, { showDate: false })).join('')}</div>` : ''}
              ${notes.map(n => `<div class="note-pill">${icon('note', 13)} ${esc(n.content)}</div>`).join('')}
              ${production.length ? (isPhone ? `<details class="prod-fold"><summary>${icon('factory', 14)} Production <b>${production.length}</b><span class="fold-dots">${[...new Set(production.map(p => p.section))].map(s => `<i style="--c:${deptColor(s)}"></i>`).join('')}</span></summary>${productionBlock(production)}</details>` : productionBlock(production)) : ''}
              ${emptyDay ? `<p class="muted small">${weekend ? '—' : 'Nothing planned'}</p>` : ''}
            </div>
          </section>`
      }).join('')}
    </div>`
}
