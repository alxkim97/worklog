import { openModal, confirmBox, toast, esc, icon } from './ui.js'
import { TYPES, STATUSES, PRIORITIES, deptColor, deptLabel } from './components.js'
import { DEPTS } from '../lib/depts.js'
import { state, isSheet, isProduction } from './store.js'
import { createTask, updateTask, deleteTask, remindColumnReady, checklistColumnReady } from './data.js'
import { putTask, dropTask, snapshot, nameOf, recordUpdate, recordCreate, recordDelete, undoIf } from './undo.js'
import { checklistFor } from './checklists.js'
import { lockForm } from './viewMode.js'
import { REMIND_OPTIONS, askPermission } from './reminders.js'
import { today, longDate } from './dates.js'

const chips = (name, options, current, { colored } = {}) => `
  <div class="choice" role="radiogroup">
    ${options.map(o => `
      <label class="choice-item"${colored ? ` style="--c:${o.color}"` : ''}>
        <input type="radio" name="${name}" value="${o.key}" ${o.key === current ? 'checked' : ''}>
        <span>${o.emoji ? `${o.emoji} ` : ''}${colored ? '<i></i>' : ''}${esc(o.label)}</span>
      </label>`).join('')}
  </div>`

// "Remind me" chips. PV lots get a 'Default' option that follows Settings.
function remindField(t) {
  if (!remindColumnReady()) return ''
  const pvDefault = t.type === 'pv_lot'
  const opts = [...(pvDefault ? [{ key: 'default', label: `Default (${state.prefs.pvRemind == null ? 'off' : REMIND_OPTIONS.find(o => o.days === state.prefs.pvRemind)?.label.toLowerCase()})` }] : []), ...REMIND_OPTIONS]
  const cur = t.remind_days == null ? (pvDefault ? 'default' : 'off') : (REMIND_OPTIONS.find(o => o.days === t.remind_days)?.key || 'off')
  return `<div class="field remind-field"><span class="field-label">${icon('bell', 14)} Remind me</span>${chips('remind', opts, cur)}</div>`
}
function readRemind(f) {
  const v = f.get('remind')
  if (v == null || v === 'default') return null
  const o = REMIND_OPTIONS.find(x => x.key === v)
  return o ? o.days : null
}
// Manual tasks: 'Off' is plain null (no default applies), except PV lots.
const remindValue = (f, type) => { const d = readRemind(f); return d === -1 && type !== 'pv_lot' ? null : d }

// PV sampling/IPC checklist. Ticks save straight away (no Save needed).
const checklistItems = items => items.map((it, i) => `
  <li class="cl-item${it.done ? ' done' : ''}">
    <label><input type="checkbox" data-cl="${i}" ${it.done ? 'checked' : ''}><span>${esc(it.t)}</span></label>
    <button type="button" class="icon-btn small cl-del" data-cl-del="${i}" aria-label="Remove item">${icon('x', 13)}</button>
  </li>`).join('')
function checklistField(t) {
  const items = checklistColumnReady() && checklistFor(t)
  if (!items) return ''
  return `
    <div class="field checklist" data-cl-box>
      <span class="field-label">${icon('check', 14)} PV checklist <b class="cl-count">${items.filter(i => i.done).length}/${items.length}</b></span>
      <ul class="cl-list">${checklistItems(items)}</ul>
      <input class="cl-add" placeholder="Add an item, press Enter" maxlength="120" autocomplete="off">
    </div>`
}
function wireChecklist(form, t, rerender) {
  const box = form.querySelector('[data-cl-box]')
  if (!box) return
  let cur = t
  let items = checklistFor(cur).map(i => ({ ...i }))
  const draw = () => {
    box.querySelector('.cl-list').innerHTML = checklistItems(items)
    box.querySelector('.cl-count').textContent = `${items.filter(i => i.done).length}/${items.length}`
  }
  // label: what the undo toast says ("tick …", "remove …", "add …")
  const save = async label => {
    const prev = snapshot(cur, { checklist: null })
    const next = { checklist: items.map(i => ({ ...i })) }
    draw()
    try {
      const row = await updateTask(cur.id, next)
      put(row, rerender)
      recordUpdate(`checklist ${label} on ${nameOf(row)}`, row.id, prev, next)
    } catch (err) { toast(err.message || 'Could not save the checklist') }
  }
  // Undo/redo changed this task while the dialog is open: show the new list.
  const onTask = e => {
    if (!box.isConnected) return window.removeEventListener('wl:task', onTask)
    if (e.detail !== cur.id) return
    cur = state.tasks.find(x => x.id === cur.id) || cur
    items = (checklistFor(cur) || []).map(i => ({ ...i }))
    draw()
  }
  window.addEventListener('wl:task', onTask)
  box.addEventListener('change', e => {
    const i = e.target.dataset.cl
    if (i == null) return
    items[i].done = e.target.checked
    save(`${e.target.checked ? 'tick' : 'untick'} “${items[i].t}”`)
  })
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-cl-del]')
    if (!b) return
    const [gone] = items.splice(Number(b.dataset.clDel), 1)
    save(`remove “${gone.t}”`)
  })
  box.querySelector('.cl-add')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const text = e.target.value.trim()
    if (!text) return
    items.push({ t: text, done: false })
    e.target.value = ''
    save(`add “${text}”`)
  })
}

// Upserts the edited row into state.tasks and redraws.
function put(row, rerender) {
  putTask(row)
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
        <div class="remind-slot">${remindField(v)}</div>
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
  lockForm(form)
  const titleInput = form.elements.title
  setTimeout(() => titleInput.focus(), 50)

  form.addEventListener('change', e => {
    if (e.target.name === 'type') {
      form.querySelector('.lot-field').hidden = !['pv_lot', 'rd_experiment'].includes(e.target.value)
      const keep = readRemind(new FormData(form))
      form.querySelector('.remind-slot').innerHTML = remindField({ type: e.target.value, remind_days: keep === -1 ? null : keep })
    }
    if (e.target.name === 'remind' && e.target.value !== 'off') askPermission()
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
      remind_days: remindValue(f, f.get('type')),
    }
    if (t) patch.status = f.get('status')
    const btn = form.querySelector('[type=submit]')
    btn.disabled = true
    try {
      const prev = t && snapshot(t, patch)
      const row = t ? await updateTask(t.id, patch) : await createTask(patch)
      put(row, rerender)
      m.close()
      if (t) recordUpdate(`edit to ${nameOf(row)}`, row.id, prev, patch)
      else recordCreate(`new task ${nameOf(row)}`, row)
      toast(t ? 'Saved' : 'Added ✓')
    } catch (err) { btn.disabled = false; toast(err.message || 'Could not save') }
  }

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!(await confirmBox(`Delete “${t.title}”?`))) return
    try {
      const row = { ...t }
      await deleteTask(t.id)
      dropTask(t.id)
      m.close()
      rerender()
      const entry = recordDelete(`delete ${nameOf(row)}`, row)
      toast('Deleted', { label: 'Undo', run: () => undoIf(entry) })
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
        ${checklistField(t)}
        ${remindField(t)}
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
  lockForm(form)
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit() })
  form.addEventListener('change', e => { if (e.target.name === 'remind' && e.target.value !== 'off') askPermission() })
  wireChecklist(form, t, rerender)
  form.onsubmit = async e => {
    e.preventDefault()
    const f = new FormData(form)
    const patch = { notes: String(f.get('notes') || '').trim() || null }
    if (tracked) patch.status = f.get('status')
    if (remindColumnReady()) patch.remind_days = remindValue(f, t.type)
    const cur = state.tasks.find(x => x.id === t.id) || t // checklist ticks may have replaced the row
    const prev = snapshot(cur, patch)
    try {
      const row = await updateTask(t.id, patch)
      put(row, rerender); m.close(); toast('Saved')
      if (JSON.stringify(prev) !== JSON.stringify(snapshot(row, patch))) recordUpdate(`edit to ${nameOf(row)}`, row.id, prev, patch)
    } catch (err) { toast(err.message || 'Could not save') }
  }
}
