import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE, isConfigured } from './config.js'
import { today, addDays } from './dates.js'

export const supa = isConfigured() ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

// ── Auth ──
export const getSession = async () => (await supa.auth.getSession()).data.session
export const onAuthChange = cb => supa.auth.onAuthStateChange((_e, session) => cb(session))
export async function signIn(email, password) {
  const { error } = await supa.auth.signInWithPassword({ email, password })
  if (error) throw error
}
export async function signUp(email, password) {
  const { data, error } = await supa.auth.signUp({ email, password })
  if (error) throw error
  return data
}
export const signOut = () => supa.auth.signOut()

export async function isMember(userId) {
  const { data, error } = await supa.from('worklog_members').select('user_id').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return !!data
}

// ── Tasks ──
// Everything from ~4 months back onward, plus anything of yours still open
// however old it is (so an overdue task never silently drops out of view).
const HISTORY_DAYS = 120
// Production-plan steps whose date has passed happened as planned — nobody
// ticks them off. Show them as done (display only; the row isn't changed)
// unless you've set a status yourself.
const auto = r => r.source === 'sheet' && r.status === 'pending' && r.due_date && r.due_date < today()
  ? { ...r, status: 'done', auto_done: true } : r

const BASE_COLS = 'id,title,type,status,priority,start_date,due_date,lot_number,product_name,section,step,assignee,notes,source,sheet_ref,sheet_path,sheet_removed_at,done_at,created_at,updated_at'
// remind_days arrived in v2.1 (supabase/SETUP.md, part D). Until that SQL has
// been run the column is missing; the app then works as before, without
// per-task reminders, instead of failing to load.
let hasRemind = true
export const remindColumnReady = () => hasRemind
const cols = () => hasRemind ? `${BASE_COLS},remind_days` : BASE_COLS
const missingColumn = e => e?.code === '42703' || /remind_days/.test(e?.message || '')

export async function fetchTasks() {
  const since = addDays(today(), -HISTORY_DAYS)
  const out = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supa.from('work_tasks').select(cols())
      .is('sheet_removed_at', null)
      .or(`due_date.gte.${since},due_date.is.null,and(source.eq.manual,status.in.(pending,in_progress))`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('id')
      .range(start, start + 999)
    if (error && hasRemind && missingColumn(error)) { hasRemind = false; return fetchTasks() }
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out.map(auto)
}

// Fields the app may write. Sheet rows only ever get status/notes/reminder changed.
const EDITABLE = ['title', 'type', 'status', 'priority', 'start_date', 'due_date', 'lot_number', 'product_name', 'section', 'assignee', 'notes', 'remind_days']
const clean = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => EDITABLE.includes(k) && (k !== 'remind_days' || hasRemind)))

export async function createTask(task) {
  const { data, error } = await supa.from('work_tasks').insert({ ...clean(task), source: 'manual' }).select(cols()).single()
  if (error) throw error
  return data
}

export async function updateTask(id, patch) {
  const { data, error } = await supa.from('work_tasks').update(clean(patch)).eq('id', id).select(cols()).single()
  if (error) throw error
  return auto(data)
}

export async function deleteTask(id) {
  const { error } = await supa.from('work_tasks').delete().eq('id', id)
  if (error) throw error
}

// Undo of a delete: put the exact row back (same id).
export async function restoreTask(row) {
  const { data, error } = await supa.from('work_tasks').insert({ id: row.id, ...clean(row), source: 'manual' }).select(cols()).single()
  if (error) throw error
  return data
}

// ── Day notes ──
export async function fetchNotes() {
  const { data, error } = await supa.from('work_date_notes').select('*')
    .gte('note_date', addDays(today(), -HISTORY_DAYS)).order('created_at')
  if (error) throw error
  return data
}
export async function addNote(note_date, content) {
  const { data, error } = await supa.from('work_date_notes').insert({ note_date, content }).select('*').single()
  if (error) throw error
  return data
}
export async function deleteNote(id) {
  const { error } = await supa.from('work_date_notes').delete().eq('id', id)
  if (error) throw error
}

// ── Sheet sync ──
export async function lastSyncRun() {
  const { data } = await supa.from('worklog_sync_runs').select('*')
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

export async function triggerSync() {
  const session = await getSession()
  const res = await fetch(`${API_BASE}/api/sync-sheet`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok === false) throw new Error(body.error || `Sync failed (${res.status})`)
  return body
}
