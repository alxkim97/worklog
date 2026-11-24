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
// Columns added after v2.0 (supabase/SETUP.md parts D and E). Until their SQL
// has been run a column is missing; the app then works without that feature
// instead of failing to load.
const OPTIONAL = ['remind_days', 'checklist']
const present = new Set(OPTIONAL)
export const remindColumnReady = () => present.has('remind_days')
export const checklistColumnReady = () => present.has('checklist')
const cols = () => [BASE_COLS, ...OPTIONAL.filter(c => present.has(c))].join(',')
// PostgREST: 'column work_tasks.checklist does not exist' (code 42703)
function dropMissing(e) {
  if (e?.code !== '42703' && !/does not exist/.test(e?.message || '')) return false
  const named = OPTIONAL.filter(c => present.has(c) && (e.message || '').includes(c))
  const drop = named.length ? named : OPTIONAL.filter(c => present.has(c))
  drop.forEach(c => present.delete(c))
  return drop.length > 0
}

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
    if (error && dropMissing(error)) return fetchTasks()
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out.map(auto)
}

// The loaded window starts here; anything older is fetched on demand.
export const historyStart = () => addDays(today(), -HISTORY_DAYS)

// Summary / report for a period that reaches past the loaded window: plan
// rows dated in it, plus your tasks marked done in it. done_at is UTC, so
// the window is padded a day each side (the summary filters by local day).
export async function fetchRange(from, to) {
  const out = []
  const lo = addDays(from, -1), hi = addDays(to, 1)
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supa.from('work_tasks').select(cols())
      .is('sheet_removed_at', null)
      .or(`and(due_date.gte.${from},due_date.lte.${to}),and(done_at.gte.${lo},done_at.lte.${hi})`)
      .order('id')
      .range(start, start + 999)
    if (error && dropMissing(error)) return fetchRange(from, to)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out.map(auto)
}

// Fields the app may write. Sheet rows only ever get status/notes/reminder changed.
const EDITABLE = ['title', 'type', 'status', 'priority', 'start_date', 'due_date', 'lot_number', 'product_name', 'section', 'assignee', 'notes', ...OPTIONAL]
const clean = obj => Object.fromEntries(Object.entries(obj).filter(([k]) => EDITABLE.includes(k) && (!OPTIONAL.includes(k) || present.has(k))))

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

// ── Settings the server also reads (worklog_settings, SETUP.md part F) ──
// e.g. 'digest' → { daily, weekend }. null = the table isn't there yet.
const missingTable = e => /worklog_settings|42P01|PGRST205|does not exist|schema cache/.test(`${e?.code} ${e?.message}`)
export async function getSetting(key) {
  const { data, error } = await supa.from('worklog_settings').select('value').eq('key', key).maybeSingle()
  if (error) { if (missingTable(error)) return null; throw error }
  return data?.value || {}
}
export async function setSetting(key, value) {
  const { error } = await supa.from('worklog_settings').upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) throw error
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
