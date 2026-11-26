// Pure parts of the WorkLog CLI (scripts/worklog-claude.js): argument
// parsing, the "what may be changed" rules, checklist ticks, reminders and
// text output. No network, no files — everything here is unit-tested
// (test/cli.test.js).
import { checklistFor } from '../src/checklists.js'
import { isSheet, nameOf, rdDay } from './rd.js'

// ── Arguments ──
// Flags that never take a value. Any other --name takes the next word.
const BOOL = new Set(['apply', 'json', 'all', 'save', 'test', 'untick', 'help'])

export function parseArgs(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--') || a === '--') { pos.push(a); continue }
    const eq = a.indexOf('=')
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2)
    if (eq > 0) flags[name] = a.slice(eq + 1)
    else if (BOOL.has(name)) flags[name] = true
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i]
    else throw new Error(`--${name} needs a value`)
  }
  return { cmd: pos.shift() || 'help', pos, flags }
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function checkDate(s, what = 'date') {
  if (!DATE_RE.test(String(s || ''))) throw new Error(`${what} must be YYYY-MM-DD (got "${s ?? ''}")`)
  return s
}

export function parseJsonArg(s) {
  if (s == null) throw new Error('Missing JSON argument, e.g. \'{"title":"…"}\'')
  let v
  try { v = JSON.parse(s) } catch (e) { throw new Error('Invalid JSON: ' + e.message) }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('JSON must be an object of fields')
  return v
}

// ── What may be written ──
export const STATUSES = ['pending', 'in_progress', 'done', 'deferred']
export const PRIORITIES = ['low', 'normal', 'high', 'critical']
export const TYPES = ['task', 'rd_experiment', 'pv_lot', 'document', 'meeting']
// Same list as src/data.js EDITABLE: what the app itself may write.
export const OWN_FIELDS = ['title', 'type', 'status', 'priority', 'start_date', 'due_date', 'lot_number', 'product_name', 'section', 'assignee', 'notes', 'remind_days', 'checklist']
// The sheet sync owns everything else on a plan row (dates, names, lot, step).
export const SHEET_FIELDS = ['status', 'notes', 'remind_days', 'checklist']

function checkValue(k, v) {
  if (k === 'status' && !STATUSES.includes(v)) throw new Error(`status must be one of ${STATUSES.join(', ')}`)
  if (k === 'priority' && !PRIORITIES.includes(v)) throw new Error(`priority must be one of ${PRIORITIES.join(', ')}`)
  if (k === 'type' && !TYPES.includes(v)) throw new Error(`type must be one of ${TYPES.join(', ')}`)
  if ((k === 'start_date' || k === 'due_date') && v !== null) checkDate(v, k)
  if (k === 'title' && !String(v || '').trim()) throw new Error('title cannot be empty')
  if (k === 'remind_days' && v !== null && !(Number.isInteger(v) && v >= -1 && v <= 60)) throw new Error('remind_days must be -1 (off), 0-60 or null (default)')
  if (k === 'checklist' && v !== null && !(Array.isArray(v) && v.every(i => i && typeof i.t === 'string' && typeof i.done === 'boolean'))) throw new Error('checklist must be a list of { "t": text, "done": true/false }')
}

// The fields of patch that may be written to row, or an error naming the rest.
export function checkPatch(row, patch) {
  const allowed = isSheet(row) ? SHEET_FIELDS : OWN_FIELDS
  const keys = Object.keys(patch)
  if (!keys.length) throw new Error('Nothing to change')
  const refused = keys.filter(k => !allowed.includes(k))
  if (refused.length) {
    throw new Error(isSheet(row)
      ? `This is a plan row from the Google Sheet: the sync owns ${refused.join(', ')}. Only ${SHEET_FIELDS.join(', ')} can be changed.`
      : `Unknown or read-only field(s): ${refused.join(', ')}. Editable: ${OWN_FIELDS.join(', ')}`)
  }
  for (const k of keys) checkValue(k, patch[k])
  return patch
}

// A new task of your own. Fills the same defaults the app's editor does.
export function checkNew(task) {
  const refused = Object.keys(task).filter(k => !OWN_FIELDS.includes(k))
  if (refused.length) throw new Error(`Unknown field(s): ${refused.join(', ')}. Allowed: ${OWN_FIELDS.join(', ')}`)
  if (!String(task.title || '').trim()) throw new Error('title is required')
  const row = { type: 'task', status: 'pending', priority: 'normal', ...task, title: String(task.title).trim() }
  if (row.due_date && !row.start_date) row.start_date = row.due_date
  for (const [k, v] of Object.entries(row)) checkValue(k, v)
  if (row.start_date && row.due_date && row.start_date > row.due_date) throw new Error('start_date is after due_date')
  return row
}

export const isOwnRow = r => r.source === 'manual'

// Reminder words → remind_days.
export function parseRemind(s) {
  const v = String(s ?? '').trim().toLowerCase()
  if (v === 'off') return -1
  if (v === 'default' || v === 'clear') return null
  if (/^\d+$/.test(v) && Number(v) <= 60) return Number(v)
  throw new Error('remind takes off, default, or a number of days before (0 = on the day, 1, 2, 3, 7 …)')
}
export const remindText = d => (d == null ? 'default' : d < 0 ? 'off' : d === 0 ? 'on the day' : d === 7 ? '1 week before' : `${d} day${d === 1 ? '' : 's'} before`)

// Tick (or untick) checklist item n (1-based). The step's default list is
// copied onto the row the first time, exactly as the app does.
export function tickPatch(row, n, done = true) {
  const items = checklistFor(row)
  if (!items) throw new Error(row.type === 'pv_lot' ? `No checklist for step "${row.step || '?'}"` : 'Only PV steps have a checklist')
  const i = Number(n) - 1
  if (!Number.isInteger(i) || i < 0 || i >= items.length) throw new Error(`Item must be 1-${items.length}`)
  return { checklist: items.map((it, k) => (k === i ? { ...it, done } : { ...it })) }
}

// ── Change log entries & undo ──
// What changed between two versions of a row, field by field.
export function changedFields(before, after) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return Object.keys(after).filter(k => !same(before?.[k], after[k])).map(k => ({ field: k, from: before?.[k] ?? null, to: after[k] ?? null }))
}

// The write that reverses a log entry { op, table, id, before, after }.
export function undoOf(entry) {
  if (entry.op === 'update') return { op: 'update', table: entry.table, id: entry.id, patch: Object.fromEntries(Object.keys(entry.after).map(k => [k, entry.before[k] ?? null])) }
  if (entry.op === 'insert') return { op: 'delete', table: entry.table, id: entry.id }
  if (entry.op === 'delete') return { op: 'insert', table: entry.table, id: entry.id, row: entry.before }
  throw new Error(`Can't undo "${entry.op}"`)
}

// Short ids: the first 8 characters of the uuid, as printed.
export const shortId = id => String(id || '').slice(0, 8)
export function matchId(rows, ref) {
  const s = String(ref || '').trim().toLowerCase()
  if (s.length < 4) throw new Error('Give at least 4 characters of the id')
  const hits = rows.filter(r => String(r.id).toLowerCase().startsWith(s))
  if (!hits.length) return null
  if (hits.length > 1) throw new Error(`"${ref}" matches ${hits.length} rows — give more of the id`)
  return hits[0]
}

// ── Text output ──
const STATUS_MARK = { pending: '[ ]', in_progress: '[~]', done: '[x]', deferred: '[-]' }
const val = v => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function checklistText(row) {
  const items = checklistFor(row)
  if (!items) return ''
  return `${items.filter(i => i.done).length}/${items.length}`
}

export function fmtTask(t, { date = true } = {}) {
  const span = t.start_date && t.due_date && t.start_date < t.due_date ? `${t.start_date}→${t.due_date}` : (t.due_date || 'no date')
  const bits = [
    STATUS_MARK[t.status] || `[${t.status}]`,
    date ? span : null,
    nameOf(t) + (t.step ? ` · ${t.step}` : ''),
    t.lot_number && !isSheet(t) ? `lot ${t.lot_number}` : null,
    t.type === 'pv_lot' && checklistText(t) ? `checklist ${checklistText(t)}` : null,
    !isSheet(t) && t.priority && t.priority !== 'normal' ? t.priority : null,
    t.remind_days != null ? `remind ${remindText(t.remind_days)}` : null,
    t.auto_done ? '(past plan step)' : null,
  ].filter(Boolean)
  return `${bits.join('  ')}${t.notes ? `  — ${t.notes.replace(/\s+/g, ' ')}` : ''}  #${shortId(t.id)}`
}

export const fmtNote = n => `${n.note_date}  ${n.content.replace(/\s+/g, ' ')}  #${shortId(n.id)}`

// A checklist reads as "1/5" plus the items that flipped, not raw JSON.
const ticks = l => (Array.isArray(l) ? `${l.filter(i => i.done).length}/${l.length}` : 'not started')
function checklistChange(from, to) {
  const flipped = (to || []).map((it, k) => ({ it, k, was: !!(Array.isArray(from) && from[k]?.done) })).filter(x => x.it.done !== x.was)
  return `${ticks(from)} → ${ticks(to)}${flipped.map(x => `\n    ${x.it.done ? 'ticked' : 'unticked'} ${x.k + 1}. ${x.it.t}`).join('')}`
}

export function fmtChanges(list) {
  return list.map(c => `  ${c.field}: ${c.field === 'checklist' ? checklistChange(c.from, c.to) : `${val(c.from)} → ${val(c.to)}`}`).join('\n')
}

// One day, the way the digest groups it (PV, R&D line, your tasks, meetings, clashes) + notes.
export function dayLines(tasks, notes, d) {
  const r = rdDay(tasks, d)
  const out = []
  const sec = (title, list) => { if (list.length) out.push(`  ${title}`, ...list.map(t => `    ${fmtTask(t, { date: false })}`)) }
  sec('PV steps', r.pv)
  sec('R&D line', r.rdLine)
  sec('My tasks', r.tasks)
  sec('Meetings', r.meetings)
  for (const c of r.clashes) out.push(`  ! Clash: ${c.text}`)
  const dn = notes.filter(n => n.note_date === d)
  if (dn.length) out.push('  Notes', ...dn.map(n => `    ${n.content.replace(/\s+/g, ' ')}  #${shortId(n.id)}`))
  return out
}

export function lotLines(lot) {
  const head = `${lot.name}${lot.lot ? ` · lot ${lot.lot}` : ''}  (${lot.first}${lot.last !== lot.first ? ` → ${lot.last}` : ''}, ${lot.done}/${lot.steps.length} steps done)`
  return [head, ...lot.steps.map(s => `    ${fmtTask(s)}`)]
}
