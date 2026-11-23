// Undo / redo for this session (Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z): status
// cycles, edits, creates, deletes, day notes and checklist ticks. Each entry
// knows how to put the database back and forward; the newest 50 are kept.
// Text fields keep the browser's own undo (app.js only routes the keys here
// when focus isn't in one).
import { state, cacheData } from './store.js'
import { updateTask, deleteTask, restoreTask, addNote, deleteNote } from './data.js'
import { toast } from './ui.js'

const MAX = 50
const done = []
const undone = []
let rerender = () => {}
let busy = false

export const setUndoRender = fn => { rerender = fn }

export function record(label, undo, redo) {
  const entry = { label, undo, redo }
  done.push(entry)
  if (done.length > MAX) done.shift()
  undone.length = 0
  return entry
}

async function run(from, to, which) {
  if (busy) return
  const e = from.pop()
  if (!e) return toast(which === 'undo' ? 'Nothing to undo' : 'Nothing to redo')
  busy = true
  try {
    await e[which]()
    to.push(e)
    toast(`${which === 'undo' ? 'Undid' : 'Redid'}: ${e.label}`)
  } catch (err) {
    toast(err.message || `Could not ${which}`) // the entry is dropped: its row has moved on
  } finally {
    busy = false
    cacheData()
    rerender()
  }
}
export const undo = () => run(done, undone, 'undo')
export const redo = () => run(undone, done, 'redo')
// A toast's own Undo button: only while that action is still the newest.
export const undoIf = entry => (done[done.length - 1] === entry ? undo() : toast('That was already changed again — use Ctrl+Z'))

// ── State helpers shared with the editor ──
export function putTask(row) {
  const i = state.tasks.findIndex(t => t.id === row.id)
  if (i === -1) state.tasks.push(row); else state.tasks[i] = row
  window.dispatchEvent(new CustomEvent('wl:task', { detail: row.id }))
}
export const dropTask = id => { state.tasks = state.tasks.filter(t => t.id !== id) }

// What the database holds now for the fields a patch touches (an auto-done
// plan step is still 'pending' underneath).
export function snapshot(t, patch) {
  const o = {}
  for (const k of Object.keys(patch)) {
    const v = k === 'status' && t.auto_done ? 'pending' : t[k]
    o[k] = v === undefined ? null : JSON.parse(JSON.stringify(v))
  }
  return o
}

export const nameOf = t => `“${t.source === 'sheet' ? (t.product_name || t.title) : t.title}”`
const clip = s => (s.length > 40 ? `${s.slice(0, 39)}…` : s)

export const recordUpdate = (label, id, prev, next) => record(label,
  async () => putTask(await updateTask(id, prev)),
  async () => putTask(await updateTask(id, next)))

export const recordCreate = (label, row) => record(label,
  async () => { await deleteTask(row.id); dropTask(row.id) },
  async () => putTask(await restoreTask(row)))

export const recordDelete = (label, row) => record(label,
  async () => putTask(await restoreTask(row)),
  async () => { await deleteTask(row.id); dropTask(row.id) })

// Notes get a new id when re-added, so the entry tracks the current one.
export function recordNoteAdd(note) {
  let cur = note
  return record(`note “${clip(note.content)}”`,
    async () => { await deleteNote(cur.id); state.notes = state.notes.filter(n => n.id !== cur.id) },
    async () => { cur = await addNote(cur.note_date, cur.content); state.notes.push(cur) })
}
export function recordNoteDelete(note) {
  let cur = note
  return record(`delete note “${clip(note.content)}”`,
    async () => { cur = await addNote(cur.note_date, cur.content); state.notes.push(cur) },
    async () => { await deleteNote(cur.id); state.notes = state.notes.filter(n => n.id !== cur.id) })
}
