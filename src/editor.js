import { openModal, confirmBox, toast, esc, icon } from './ui.js'
import { TYPES, STATUSES, PRIORITIES, deptColor, deptLabel } from './components.js'
import { DEPTS } from '../lib/depts.js'
import { state, isSheet, isProduction } from './store.js'
import { createTask, updateTask, deleteTask, restoreTask } from './data.js'
import { today, longDate } from './dates.js'

const chips = (name, options, current, { colored } = {}) => `
  <div class="choice" role="radiogroup">
    ${options.map(o => `
      <label class="choice-item"${colored ? ` style="--c:${o.color}"` : ''}>
        <input type="radio" name="${name}" value="${o.key}" ${o.key === current ? 'checked' : ''}>
        <span>${o.emoji ? `${o.emoji} ` : ''}${colored ? '<i></i>' : ''}${esc(o.label)}</span>
      </label>`).join('')}
  </div>`

// Upserts the edited row into state.tasks and redraws.
function put(row, rerender) {
  const i = state.tasks.findIndex(t => t.id === row.id)
  if (i === -1) state.tasks.push(row); else state.tasks[i] = row
  rerender()
}

export function openEditor({ id, date } = {}, rerender) {
  const t = id ? state.tasks.find(x => x.id === id) : null
  if (id && !t) return
  if (t && isSheet(t)) return openSheetTask(t, rerender)

  const v = t || { title: '', type: 'task', status: 'pending', priority: 'normal', section: 'rd', due_date: date || today(), start_date: null, notes: '', lot_number: '' }
  const multi = !!(v.start_date && v.start_date < v.due_date)
  // Phone quick add: title, type, date — the rest folds away.
  const quickAdd = matchMedia('(max-width: 859px)').matches
  const m = openModal(`
    <form class="editor" novalidate>
      <header class="modal-head">
        <h2>${t ? 'Edit task' : 'New task'}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </header>
      <div class="modal-body">
        <input class="title-input" name="title" placeholder="What needs doing?" value="${esc(v.title)}" maxlength="200" required autocomplete="off">
        ${chips('type', TYPES, v.type)}
        <div class="field-row">
          <label class="field">${multi ? 'From' : 'Date'}<input type="date" name="${multi ? 'start_date' : 'due_date'}" value="${multi ? v.start_date : (v.due_date || '')}"></label>
          ${multi ? `<label class="field">Until<input type="date" name="due_date" value="${v.due_date || ''}"></label>`
            : `<button type="button" class="link span-btn" data-span>+ Spans several days</button>`}
        </div>
        ${t ? `<div class="field"><span class="field-label">Status</span>${chips('status', STATUSES, v.status)}</div>` : ''}
        <details class="more-opts" ${t || !quickAdd ? 'open' : ''}>
          <summary>More options</summary>
          <div class="more-body">
            <div class="field"><span class="field-label">Department</span>${chips('section', DEPTS.filter(d => d.key !== 'other'), v.section || 'rd', { colored: true })}</div>
            <div class="field"><span class="field-label">Priority</span>${chips('priority', PRIORITIES, v.priority)}</div>
            <label class="field lot-field" ${['pv_lot', 'rd_experiment'].includes(v.type) ? '' : 'hidden'}>Lot / batch no.<input name="lot_number" value="${esc(v.lot_number || '')}" maxlength="40" autocomplete="off"></label>
            <label class="field">Notes<textarea name="notes" rows="3" placeholder="Details, links, results…">${esc(v.notes || '')}</textarea></label>
          </div>
        </details>
      </div>
      <footer class="modal-foot">
        ${t ? `<button type="button" class="btn ghost danger-text" data-delete>${icon('trash', 16)} Delete</button>` : '<span></span>'}
        <div class="row-gap">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn primary">${t ? 'Save' : 'Add task'}</button>
        </div>
      </footer>
    </form>`)

  const form = m.el.querySelector('form')
  const titleInput = form.elements.title
  setTimeout(() => titleInput.focus(), 50)

  form.addEventListener('change', e => {
    if (e.target.name === 'type') form.querySelector('.lot-field').hidden = !['pv_lot', 'rd_experiment'].includes(e.target.value)
  })
  form.querySelector('[data-span]')?.addEventListener('click', e => {
    const row = e.target.closest('.field-row')
    const d = form.elements.due_date.value || today()
    row.innerHTML = `
      <label class="field">From<input type="date" name="start_date" value="${d}"></label>
      <label class="field">Until<input type="date" name="due_date" value="${d}"></label>`
  })
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit() })

  form.onsubmit = async e => {
    e.preventDefault()
    const f = new FormData(form)
    const title = String(f.get('title') || '').trim()
    if (!title) { titleInput.focus(); titleInput.classList.add('shake'); setTimeout(() => titleInput.classList.remove('shake'), 400); return }
    let start = f.get('start_date') || null
    let due = f.get('due_date') || null
    if (start && due && start > due) [start, due] = [due, start]
    if (start && !due) { due = start; start = null }
    const patch = {
      title, type: f.get('type'), section: f.get('section'), priority: f.get('priority'),
      start_date: start && start !== due ? start : null, due_date: due,
      notes: String(f.get('notes') || '').trim() || null,
      lot_number: String(f.get('lot_number') || '').trim() || null,
    }
    if (t) patch.status = f.get('status')
    const btn = form.querySelector('[type=submit]')
    btn.disabled = true
    try {
      const row = t ? await updateTask(t.id, patch) : await createTask(patch)
      put(row, rerender)
      m.close()
      toast(t ? 'Saved' : 'Added ✓')
    } catch (err) { btn.disabled = false; toast(err.message || 'Could not save') }
  }

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!(await confirmBox(`Delete “${t.title}”?`))) return
    try {
      await deleteTask(t.id)
      state.tasks = state.tasks.filter(x => x.id !== t.id)
      m.close()
      rerender()
      toast('Deleted', { label: 'Undo', run: async () => { try { put(await restoreTask(t), rerender) } catch (err) { toast(err.message) } } })
    } catch (err) { toast(err.message || 'Could not delete') }
  })
}

// Production-plan rows: the sheet owns everything except status (PV lots)
// and your notes.
function openSheetTask(t, rerender) {
  const tracked = !isProduction(t)
  const m = openModal(`
    <form class="editor">
      <header class="modal-head" style="--c:${deptColor(t.section)}">
        <div>
          <p class="eyebrow dept-eyebrow"><i></i>${esc(deptLabel(t.section))}${t.step ? ` · ${esc(t.step)}` : ''}${t.type === 'pv_lot' ? ' · PV lot' : ''}</p>
          <h2>${esc(t.product_name || t.title)}</h2>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </header>
      <div class="modal-body">
        <dl class="facts">
          <div><dt>Date</dt><dd>${esc(longDate(t.due_date))}</dd></div>
          ${t.lot_number ? `<div><dt>Lot</dt><dd>${esc(t.lot_number)}</dd></div>` : ''}
          ${t.sheet_path ? `<div><dt>Sheet row</dt><dd>${esc(t.sheet_path)}</dd></div>` : ''}
        </dl>
        <p class="muted small">${icon('factory', 14)} From the production plan. Dates and names update from the sheet; your status and notes are kept.</p>
        ${tracked ? `<div class="field"><span class="field-label">Status</span>${chips('status', STATUSES, t.status)}</div>` : ''}
        <label class="field">Your notes<textarea name="notes" rows="3" placeholder="Observations, sample IDs…">${esc(t.notes || '')}</textarea></label>
      </div>
      <footer class="modal-foot">
        <span></span>
        <div class="row-gap">
          <button type="button" class="btn ghost" data-close>Close</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </footer>
    </form>`)
  const form = m.el.querySelector('form')
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit() })
  form.onsubmit = async e => {
    e.preventDefault()
    const f = new FormData(form)
    const patch = { notes: String(f.get('notes') || '').trim() || null }
    if (tracked) patch.status = f.get('status')
    try { put(await updateTask(t.id, patch), rerender); m.close(); toast('Saved') } catch (err) { toast(err.message || 'Could not save') }
  }
}
