import { pvLots } from '../store.js'
import { today, shortDate, relDay } from '../dates.js'
import { deptColor, deptLabel, statusButton, empty, clFlag } from '../components.js'
import { esc } from '../ui.js'

export function renderLots() {
  const lots = pvLots()
  if (!lots.length) return `<div class="lots">${empty('No PV lots on the production plan yet. They show up here after the next sheet sync.', '🏷️')}</div>`
  const t = today()
  const active = lots.filter(l => l.last >= t)
  const past = lots.filter(l => l.last < t)
  return `
    <div class="lots">
      ${active.length ? `<div class="lot-grid">${active.map(lotCard).join('')}</div>` : ''}
      ${past.length ? `<h3 class="sub">Finished</h3><div class="lot-grid past">${past.map(lotCard).join('')}</div>` : ''}
    </div>`
}

function lotCard(l) {
  const pct = Math.round((l.done / l.steps.length) * 100)
  const t = today()
  const next = l.steps.find(s => s.status !== 'done' && s.due_date >= t)
  return `
    <article class="lot card">
      <header>
        <div>
          <h3>${esc(l.name)}</h3>
          <p class="muted small">${l.lot ? `Lot ${esc(l.lot)} · ` : ''}${esc(shortDate(l.first))}${l.last !== l.first ? ` → ${esc(shortDate(l.last))}` : ''}</p>
        </div>
        <div class="ring" style="--p:${pct}"><span>${l.done}/${l.steps.length}</span></div>
      </header>
      ${next ? `<p class="lot-next">Next: <b>${esc(next.step || deptLabel(next.section))}</b> ${esc(relDay(next.due_date))}</p>` : ''}
      <ol class="steps">
        ${l.steps.map(s => `
          <li class="step s-${s.status}${s.due_date < t && s.status !== 'done' ? ' late' : ''}" style="--c:${deptColor(s.section)}">
            ${statusButton(s)}
            <button type="button" class="step-body" data-act="open" data-id="${s.id}">
              <span class="step-name">${esc(s.step || deptLabel(s.section))}</span>
              ${clFlag(s)}<span class="step-date">${esc(shortDate(s.due_date))}</span>
            </button>
          </li>`).join('')}
      </ol>
    </article>`
}
