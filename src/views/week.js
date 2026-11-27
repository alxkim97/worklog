import { state, dayContent } from '../store.js'
import { today, addDays, weekStart, monthStart, weekday, dayNum, isWeekend, shortDate, fromStr } from '../dates.js'
import { productionBlock, deptColor } from '../components.js'
import { esc, icon } from '../ui.js'
import { clashTitle } from '../clashes.js'
import { itemsOn, card, block, ghostsOn, ghostCard } from '../activity.js'

// "WorkLog Week 22-28 Nov 2026 (R.0_261123).pdf" — authored-file naming.
export function printFileName() {
  const s = weekStart(state.cursor)
  const e = addDays(s, 6)
  const fmt = d => fromStr(d).toLocaleString('en-GB', { day: 'numeric', month: 'short' })
  const range = s.slice(0, 7) === e.slice(0, 7) ? `${dayNum(s)}-${fmt(e)}` : `${fmt(s)} - ${fmt(e)}`
  const t = today()
  return `WorkLog Week ${range} ${e.slice(0, 4)} (R.0_${t.slice(2, 4)}${t.slice(5, 7)}${t.slice(8, 10)}).pdf`
}

export function weekTitle() {
  const s = weekStart(state.cursor)
  const e = addDays(s, 6)
  // "23–29 Nov" in one month, "30 Nov – 6 Dec" across two
  if (s.slice(0, 7) === e.slice(0, 7)) return `${dayNum(s)}–${shortDate(e)}`
  return `${shortDate(s)} – ${shortDate(e)}`
}

const deptDots = list => [...new Set(list.map(t => deptColor(t.section || 'rd')))].slice(0, 4).map(c => `<i style="--c:${c}"></i>`).join('')

// Desktop: a 7-column board. Each column lists the R&D activities as cards;
// the rest of production folds into one "Production N" line (click to open
// it on every day at once).
export function renderWeek({ isPhone } = {}) {
  if (isPhone) return renderPhonePlan()
  const s = weekStart(state.cursor)
  const t = today()
  const days = Array.from({ length: 7 }, (_, i) => addDays(s, i))
  const content = days.map(d => {
    const c = dayContent(d)
    const items = itemsOn(d)
    return { ...c, items, prod: c.production.filter(p => !items.includes(p)) }
  })
  const isEmpty = c => !c.items.length && !c.prod.length && !c.notes.length
  // Empty weekend days shrink to a narrow strip so the working days get the width.
  const cols = days.map((d, i) => isWeekend(d) && isEmpty(content[i]) ? 'minmax(56px, .3fr)' : 'minmax(0, 1fr)').join(' ')
  const layer = { all: 'All production', pv: 'PV + R&D line', off: 'Mine only' }[state.prefs.production]
  const open = !!state.prefs.weekProd
  return `
    <div class="print-head"><b>WorkLog · Week ${esc(weekTitle())} ${s.slice(0, 4)}</b><span>${esc(layer)} · printed ${esc(new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
    <div class="board${open ? ' prod-open' : ''}" style="--week-cols:${cols}">
      ${days.map((d, i) => {
        const { items, prod, notes } = content[i]
        const weekend = isWeekend(d)
        const emptyDay = isEmpty(content[i])
        const clash = clashTitle(d)
        const showMonth = dayNum(d) === 1 || i === 0
        return `
          <section class="col${d === t ? ' is-today' : ''}${weekend ? ' weekend' : ''}${emptyDay ? ' empty-day' : ''}${clash ? ' has-clash' : ''}">
            <header class="col-h" data-act="day" data-date="${d}" title="Open ${esc(shortDate(d))} in Month">
              <small>${esc(weekday(d))}</small><b>${dayNum(d)}</b>${showMonth ? `<small>${esc(fromStr(d).toLocaleString('en-GB', { month: 'short' }))}</small>` : ''}
              ${clash ? `<span class="clash-badge" title="Clash — ${esc(clash)}" aria-label="Clash: ${esc(clash)}">!</span>` : ''}
              <button type="button" class="icon-btn small add-day" data-act="new" data-date="${d}" aria-label="Add on ${esc(shortDate(d))}">${icon('plus', 16)}</button>
            </header>
            <div class="col-b">
              ${ghostsOn(d).map(ghostCard).join('')}
              ${items.map(card).join('')}
              ${notes.map(n => `<div class="note-pill">${icon('note', 13)} ${esc(n.content)}</div>`).join('')}
              ${emptyDay ? `<p class="col-empty">${weekend ? '—' : 'Nothing for R&amp;D'}</p>` : ''}
            </div>
            ${prod.length ? `
              <button type="button" class="col-prod" data-act="week-prod" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} production">
                <span>Production <b>${prod.length}</b></span>${icon('down', 14)}
              </button>
              <div class="col-prod-list">${productionBlock(prod)}</div>` : ''}
          </section>`
      }).join('')}
    </div>`
}

// Phone Plan: agenda first. A week strip (or the month grid, opened from the
// title) picks the first day; the list shows that day and the six after it.
export const phoneTitle = () => fromStr(state.cursor).toLocaleString('en-GB', { month: 'long' }) + (state.cursor.slice(0, 4) === today().slice(0, 4) ? '' : ` ${state.cursor.slice(0, 4)}`)

function pickerDay(d, t, cur, { out = false, letter = false } = {}) {
  const cls = ['pd', out && 'out', d === t && 'is-today', d === cur && 'sel'].filter(Boolean).join(' ')
  return `<button type="button" class="${cls}" data-act="pday" data-date="${d}">${letter ? `<small>${esc(weekday(d).slice(0, 1))}</small>` : ''}<span class="n">${dayNum(d)}</span><span class="dots">${deptDots(itemsOn(d))}</span></button>`
}

function renderPhonePlan() {
  const t = today()
  const cur = state.cursor
  let picker
  if (state.phoneMonth) {
    const first = monthStart(cur)
    const start = weekStart(first)
    const weeks = addDays(start, 35).slice(0, 7) === first.slice(0, 7) ? 6 : 5
    picker = `<div class="pmonth">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(w => `<small>${w}</small>`).join('')}${Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)).map(d => pickerDay(d, t, cur, { out: d.slice(0, 7) !== first.slice(0, 7) })).join('')}</div>`
  } else {
    const s = weekStart(cur)
    picker = `<div class="pweek">${Array.from({ length: 7 }, (_, i) => pickerDay(addDays(s, i), t, cur, { letter: true })).join('')}</div>`
  }
  const list = Array.from({ length: 7 }, (_, i) => addDays(cur, i)).map(d => {
    const { production, notes } = dayContent(d)
    const items = itemsOn(d)
    const prod = production.filter(p => !items.includes(p))
    const nothing = !items.length && !notes.length && !prod.length
    if (nothing && d !== t && d !== cur) return ''
    return `
      <section class="pday${d === t ? ' is-today' : ''}">
        <div class="pdate"><small>${esc(weekday(d))}</small><b>${dayNum(d)}</b></div>
        <div class="pevs">
          ${items.map(block).join('')}
          ${notes.map(n => `<div class="note-pill">${icon('note', 13)} ${esc(n.content)}</div>`).join('')}
          ${prod.length ? `<details class="prod-fold"><summary>${icon('factory', 14)} Production <b>${prod.length}</b><span class="fold-dots">${deptDots(prod)}</span></summary>${productionBlock(prod)}</details>` : ''}
          ${nothing ? '<p class="col-empty">Nothing planned</p>' : ''}
        </div>
      </section>`
  }).join('')
  return `<div class="pplan">${picker}<div class="plist">${list}</div></div>`
}
