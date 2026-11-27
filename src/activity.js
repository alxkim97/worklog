// One activity (PV step, R&D-line run, or your own task) drawn four ways:
// a month chip, a week card, a sidebar agenda line and a phone block. Each
// shows only the essentials; the rest is in the hover popover (desktop) or
// the editor (click / tap). Colour = department.
import { esc, icon } from './ui.js'
import { state, visible, onDay, isTracked, isRdLine, isSheet, byImportance } from './store.js'
import { deptColor, deptLabel, TYPE_BY_KEY, statusLabel, statusButton } from './components.js'
import { nameOf } from '../lib/rd.js'
import { checklistProgress } from './checklists.js'
import { markOf, MARK_LABEL } from './marks.js'
import { longDate, shortDate } from './dates.js'

export const pvNo = t => { const m = `${t.product_name || ''} ${t.title || ''}`.match(/\bPV\s*(\d+)\b/i); return m ? `PV${m[1]}` : null }
// "BANOCINORAL 50×1g (04) PV1" → "BANOCINORAL 50×1g" (PV and lot get their own tags)
export const shortName = t => {
  const n = nameOf(t)
  if (!isSheet(t)) return n
  return n.replace(/\s*\bPV\s*\d+\b/i, '').replace(/\s*\(\d+\)\s*$/, '').trim() || n
}
export const kindOf = t => (!isSheet(t) ? 'mine' : t.type === 'pv_lot' ? 'pv' : isRdLine(t) ? 'rd' : 'prod')
const colorOf = t => deptColor(t.section || 'rd')

// What R&D cares about on a day: your tasks, PV steps and R&D-line runs.
export function itemsOn(d, tasks = state.tasks) {
  return tasks.filter(t => visible(t) && onDay(t, d) && (isTracked(t) || isRdLine(t))).sort(byImportance)
}

const tag = t => { const pv = pvNo(t); return pv ? `<span class="tg">${pv}</span>` : kindOf(t) === 'rd' ? '<span class="tg">R&amp;D</span>' : '' }
const lead = t => kindOf(t) === 'mine' ? (TYPE_BY_KEY[t.type]?.label || 'Task') : (t.step || deptLabel(t.section))
function markBadge(t) {
  const m = markOf(t.id)
  return m ? `<i class="mk mk-${m.kind}">${MARK_LABEL[m.kind]}</i>` : ''
}
const cls = (base, t) => [base, `k-${kindOf(t)}`, `s-${t.status}`, markOf(t.id) && 'marked'].filter(Boolean).join(' ')
const attrs = t => `style="--c:${colorOf(t)}" data-act="open" data-id="${t.id}" data-pop="${t.id}" tabindex="0"`
const subline = t => {
  const k = kindOf(t)
  if (k === 'mine') return [TYPE_BY_KEY[t.type]?.label || 'Task', t.lot_number && `Lot ${t.lot_number}`].filter(Boolean).join(' · ')
  return [pvNo(t), t.lot_number && `Lot ${t.lot_number}`, t.step, k === 'rd' && 'R&D line'].filter(Boolean).join(' · ')
}

// Month cell chip: step · name · PV tag
export const chip = t => `
  <div class="ev ${cls('', t)}" ${attrs(t)}>${kindOf(t) === 'mine' ? '' : `<b class="st">${esc(t.step || '')}</b>`}<span class="tx">${esc(shortName(t))}</span>${tag(t)}${markBadge(t)}</div>`

// Week board card: STEP + tag, then the name
export const card = t => `
  <div class="${cls('wcard', t)}" ${attrs(t)}>
    <span class="st">${esc(lead(t))}${tag(t)}</span>
    <span class="tx">${esc(shortName(t))}</span>${markBadge(t)}
  </div>`

// Sidebar agenda line: a tick box for anything with a status, else a dot
export const agendaItem = t => `
  <div class="${cls('ag-item', t)}" ${attrs(t)}>${isTracked(t) ? statusButton(t) : '<i></i>'}<b>${esc(kindOf(t) === 'mine' ? shortName(t) : `${t.step ? t.step + ' · ' : ''}${shortName(t)}`)}${markBadge(t)}</b><small>${esc(subline(t))}</small></div>`

// Phone agenda block (solid colour for plan steps, tinted for your own)
export const block = t => `
  <div class="${cls('pblock', t)}" ${attrs(t)}><b>${esc(shortName(t))}${markBadge(t)}</b><small>${esc(subline(t))}</small></div>`

// Hover popover body
export function popHTML(t) {
  const k = kindOf(t)
  const m = markOf(t.id)
  const cl = checklistProgress(t)
  const date = t.due_date ? (t.start_date && t.start_date < t.due_date ? `${shortDate(t.start_date)} → ${shortDate(t.due_date)}` : longDate(t.due_date)) : 'No date'
  const was = m?.kind === 'moved' && m.from ? ` <span class="was">was ${esc(shortDate(m.from))}</span>` : m?.kind === 'added' ? ' <span class="was">new in the plan</span>' : ''
  const status = statusLabel(t.status)
  const rows = k === 'mine'
    ? [['Date', date + was], ['Status', status], t.lot_number && ['Lot', esc(t.lot_number)], t.priority === 'critical' && ['Priority', 'Urgent'], t.priority === 'high' && ['Priority', 'High']]
    : [['Date', esc(date) + was], pvNo(t) && ['PV', `<span class="tg">${pvNo(t)}</span>`], t.lot_number && ['Lot', esc(t.lot_number)], t.step && ['Step', esc(t.step)],
       t.sheet_path && ['Where', esc(t.sheet_path)], cl && ['Checklist', `${cl.done}/${cl.total}`], ['Status', status]]
  const eyebrow = k === 'mine' ? `${TYPE_BY_KEY[t.type]?.label || 'Task'} · yours` : `${k === 'pv' ? 'PV step' : k === 'rd' ? 'R&D line' : 'Production'} · ${deptLabel(t.section)}`
  const note = t.notes ? `<p class="pop-note">${icon('note', 13)} ${esc(t.notes.length > 140 ? t.notes.slice(0, 140) + '…' : t.notes)}</p>` : ''
  return `
    <div class="pop-h" style="--c:${colorOf(t)}"><small>${esc(eyebrow)}</small><b>${esc(shortName(t))}</b></div>
    <dl>${rows.filter(Boolean).map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>${note}
    <p class="pop-hint">Click to open</p>`
}
