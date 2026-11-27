// Pieces of markup shared by every view. Interaction is wired by data-act
// attributes and one delegated click handler in app.js.
import { esc, icon } from './ui.js'
import { DEPT_BY_KEY } from '../lib/depts.js'
import { relDay, relHint, shortDate } from './dates.js'
import { isOverdue, isSheet, isRdLine, groupByDept } from './store.js'
import { reminderFor, remindLabel } from './reminders.js'
import { checklistProgress } from './checklists.js'

// hidden on finished steps you never ticked (past plan steps count as done)
export const clFlag = t => { const p = checklistProgress(t); return p && (p.started || t.status !== 'done') ? `<span class="flag cl${p.done === p.total ? ' full' : ''}" title="PV checklist">${icon('check', 11)}${p.done}/${p.total}</span>` : '' }
const bell = t => { const r = reminderFor(t); return r ? `<span class="has-bell" title="Reminder: ${esc(remindLabel(r.days))}${r.auto ? ' (PV default)' : ''}">${icon('bell', 13)}</span>` : '' }

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

// "Doing" is gone from the app: a row stored as in_progress (a reopened past
// plan step) simply reads as To do.
export const statusLabel = s => ({ pending: 'To do', in_progress: 'To do', done: 'Done', deferred: 'Later' }[s] || s)
export const formStatus = s => (s === 'in_progress' ? 'pending' : s)

// Status circle: one tap = done, another tap = back to do.
export function statusButton(t) {
  const label = t.status === 'done' ? 'Reopen' : t.status === 'deferred' ? 'Reopen' : 'Mark done'
  return `<button type="button" class="check s-${t.status === 'in_progress' ? 'pending' : t.status}" data-act="cycle" data-id="${t.id}" aria-label="${label}" title="${label}">${t.status === 'done' ? icon('check', 14) : ''}</button>`
}

// A tracked task (yours or a PV lot) as a row.
export function taskRow(t, { showDate = true } = {}) {
  const type = TYPE_BY_KEY[t.type]
  const meta = []
  if (showDate && t.due_date) {
    meta.push(t.start_date && t.start_date < t.due_date ? `${shortDate(t.start_date)} → ${shortDate(t.due_date)}` : relDay(t.due_date))
    if (relHint(t.due_date)) meta.push({ hint: relHint(t.due_date) })
  } else if (t.start_date && t.start_date < t.due_date) {
    meta.push(`until ${relDay(t.due_date)}`)
  }
  if (isSheet(t)) meta.push(t.step ? `${deptLabel(t.section)} · ${t.step}` : deptLabel(t.section))
  else if (type && t.type !== 'task') meta.push(type.label)
  if (t.lot_number && !isSheet(t)) meta.push(`Lot ${t.lot_number}`)
  const flags = [
    t.priority === 'critical' ? '<span class="flag urgent">Urgent</span>' : t.priority === 'high' ? '<span class="flag high">High</span>' : '',
    isOverdue(t) ? '<span class="flag late">Late</span>' : '',
    t.type === 'pv_lot' ? '<span class="flag pv">PV</span>' : '',
    t.notes ? `<span class="has-note" title="Has notes">${icon('note', 13)}</span>` : '',
    bell(t),
    clFlag(t),
  ].join('')
  return `
    <div class="task s-${t.status}" style="--c:${deptColor(t.section || 'rd')}" data-act="open" data-id="${t.id}" tabindex="0">
      ${statusButton(t)}
      <div class="task-main">
        <div class="task-title">${esc(isSheet(t) ? (t.product_name || t.title) : t.title)}</div>
        ${meta.length ? `<div class="task-meta">${meta.map(m => m.hint ? `<span class="hint">${esc(m.hint)}</span>` : `<span class="mp">${esc(m)}</span>`).join(' · ').replace(/ · (<span class="hint">)/g, ' $1')}</div>` : ''}
      </div>
      <div class="task-flags">${flags}</div>
    </div>`
}

// Production plan item as a small coloured chip.
// (map() passes an index as the 2nd arg — opts?.date is undefined then.)
export const prodChip = (t, opts) => `
  <button type="button" class="chip${isRdLine(t) ? ' rd-line' : ''}" style="--c:${deptColor(t.section)}" data-act="open" data-id="${t.id}" title="${esc([t.step, t.product_name || t.title].filter(Boolean).join(' · ') + (t.sheet_path ? ` — ${t.sheet_path}` : ''))}">
    ${t.step ? `<span class="chip-step">${esc(t.step)}</span>` : ''}${isRdLine(t) ? '<span class="rd-mark">R&amp;D</span>' : ''}<span class="chip-name">${esc(t.product_name || t.title)}</span>${bell(t)}${opts?.date ? `<span class="chip-date">${esc(shortDate(t.due_date))}</span>` : ''}
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
