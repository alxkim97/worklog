// Pieces of markup shared by every view. Interaction is wired by data-act
// attributes and one delegated click handler in main.js.
import { esc, icon } from './ui.js'
import { DEPT_BY_KEY } from '../lib/depts.js'
import { relDay, shortDate } from './dates.js'
import { isOverdue, isSheet, isRdLine, groupByDept } from './store.js'

export const TYPES = [
  { key: 'task', label: 'Task', emoji: '✅' },
  { key: 'rd_experiment', label: 'Experiment', emoji: '🧪' },
  { key: 'pv_lot', label: 'PV lot', emoji: '🏷️' },
  { key: 'document', label: 'Document', emoji: '📄' },
  { key: 'meeting', label: 'Meeting', emoji: '🗓️' },
]
export const TYPE_BY_KEY = Object.fromEntries(TYPES.map(t => [t.key, t]))
export const STATUSES = [
  { key: 'pending', label: 'To do' },
  { key: 'in_progress', label: 'Doing' },
  { key: 'done', label: 'Done' },
  { key: 'deferred', label: 'Later' },
]
export const PRIORITIES = [
  { key: 'low', label: 'Low' },
  { key: 'normal', label: 'Normal' },
  { key: 'high', label: 'High' },
  { key: 'critical', label: 'Urgent' },
]

export const deptColor = key => (DEPT_BY_KEY[key] || DEPT_BY_KEY.other).color
export const deptLabel = key => (DEPT_BY_KEY[key] || DEPT_BY_KEY.other).label

// Status circle: tap cycles To do → Doing → Done.
export function statusButton(t) {
  const label = { pending: 'Start', in_progress: 'Mark done', done: 'Reopen', deferred: 'Reopen' }[t.status]
  return `<button type="button" class="check s-${t.status}" data-act="cycle" data-id="${t.id}" aria-label="${label}" title="${label}">${t.status === 'done' ? icon('check', 14) : t.status === 'in_progress' ? '<span class="half"></span>' : ''}</button>`
}

// A tracked task (yours or a PV lot) as a row.
export function taskRow(t, { showDate = true } = {}) {
  const type = TYPE_BY_KEY[t.type]
  const meta = []
  if (showDate && t.due_date) {
    meta.push(t.start_date && t.start_date < t.due_date ? `${shortDate(t.start_date)} → ${shortDate(t.due_date)}` : relDay(t.due_date))
  } else if (t.start_date && t.start_date < t.due_date) {
    meta.push(`until ${relDay(t.due_date)}`)
  }
  if (isSheet(t)) meta.push(t.step ? `${deptLabel(t.section)} · ${t.step}` : deptLabel(t.section))
  else if (type && t.type !== 'task') meta.push(type.label)
  if (t.lot_number && !isSheet(t)) meta.push(`Lot ${esc(t.lot_number)}`)
  const flags = [
    t.priority === 'critical' ? '<span class="flag urgent">Urgent</span>' : t.priority === 'high' ? '<span class="flag high">High</span>' : '',
    isOverdue(t) ? '<span class="flag late">Late</span>' : '',
    t.type === 'pv_lot' ? '<span class="flag pv">PV</span>' : '',
    t.notes ? `<span class="has-note" title="Has notes">${icon('note', 13)}</span>` : '',
  ].join('')
  return `
    <div class="task s-${t.status}" style="--c:${deptColor(t.section || 'rd')}" data-act="open" data-id="${t.id}" tabindex="0">
      ${statusButton(t)}
      <div class="task-main">
        <div class="task-title">${esc(isSheet(t) ? (t.product_name || t.title) : t.title)}</div>
        ${meta.length ? `<div class="task-meta">${meta.map(esc).join(' · ')}</div>` : ''}
      </div>
      <div class="task-flags">${flags}</div>
    </div>`
}

// Production plan item as a small coloured chip.
// (map() passes an index as the 2nd arg — opts?.date is undefined then.)
export const prodChip = (t, opts) => `
  <button type="button" class="chip${isRdLine(t) ? ' rd-line' : ''}" style="--c:${deptColor(t.section)}" data-act="open" data-id="${t.id}" title="${esc(t.sheet_path || '')}">
    ${t.step ? `<span class="chip-step">${esc(t.step)}</span>` : ''}${isRdLine(t) ? '<span class="rd-mark">R&amp;D</span>' : ''}<span class="chip-name">${esc(t.product_name || t.title)}</span>${opts?.date ? `<span class="chip-date">${esc(shortDate(t.due_date))}</span>` : ''}
  </button>`

// Production for one day, grouped by department.
export function productionBlock(tasks, { compact = false } = {}) {
  if (!tasks.length) return ''
  return groupByDept(tasks).map(({ dept, tasks }) => `
    <div class="prod-group" style="--c:${dept.color}">
      <div class="prod-head"><span class="dot"></span>${esc(dept.label)}<span class="count">${tasks.length}</span></div>
      ${compact ? '' : `<div class="chips">${tasks.map(prodChip).join('')}</div>`}
    </div>`).join('')
}

export const empty = (text, emoji = '🌤️') => `<div class="empty"><div class="empty-emoji">${emoji}</div><p>${esc(text)}</p></div>`

export function noteList(notes, date) {
  return `
    <div class="notes" data-date="${date}">
      ${notes.map(n => `
        <div class="note-item">
          <span>${esc(n.content)}</span>
          <button type="button" class="icon-btn small" data-act="del-note" data-id="${n.id}" aria-label="Delete note">${icon('x', 14)}</button>
        </div>`).join('')}
      <form class="note-add" data-date="${date}">
        <input name="note" placeholder="Add a note for this day…" autocomplete="off" maxlength="300">
      </form>
    </div>`
}
