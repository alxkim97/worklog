// Server-side sheet → Supabase sync (used by api/sync-sheet.js and
// scripts/snapshot-sheet.js). Node only: needs node:crypto for the Google
// service-account login, which is a plain RS256 JWT — no googleapis package.

import { createSign } from 'node:crypto'
import { parseSheet } from './sheetParser.js'

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'
const CHUNK = 500

const b64url = s => Buffer.from(s).toString('base64url')

export async function googleToken(serviceAccount) {
  const sa = typeof serviceAccount === 'string' ? JSON.parse(serviceAccount) : serviceAccount
  const now = Math.floor(Date.now() / 1000)
  const unsigned = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Google login failed: ${data.error_description || data.error || res.status}`)
  return data.access_token
}

// Rows of the "PLAN" tab (case-insensitive), falling back to the first tab.
export async function fetchPlanRows(token, sheetId) {
  const get = async url => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Google Sheets: ${data.error?.message || res.status}`)
    return data
  }
  const meta = await get(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`)
  const titles = (meta.sheets || []).map(s => s.properties.title)
  const tab = titles.find(t => t.trim().toUpperCase() === 'PLAN') || titles[0]
  if (!tab) throw new Error('Spreadsheet has no tabs')
  const data = await get(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${tab}!A1:AZ2000`)}`)
  return data.values || []
}

// Writes parsed tasks with the service-role client (bypasses RLS).
//  - Upsert sends sheet-owned columns only, so status/notes/priority/assignee
//    keep whatever the user set (new rows get the table defaults).
//  - Rows the sheet no longer has, inside the date range this sheet covers,
//    get sheet_removed_at instead of lingering as ghosts. Rows outside that
//    range (old months deleted from the sheet) are history and stay as-is.
export async function writeTasks(supa, tasks) {
  const runAt = new Date().toISOString()
  if (!tasks.length) return { found: 0, added: 0, removed: 0, restored: 0 }

  const dates = tasks.map(t => t.due_date).sort()
  const from = dates[0], to = dates[dates.length - 1]

  const existing = new Map()
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supa.from('work_tasks')
      .select('sheet_ref, sheet_removed_at').eq('source', 'sheet')
      .range(start, start + 999)
    if (error) throw error
    for (const r of data) existing.set(r.sheet_ref, r)
    if (data.length < 1000) break
  }

  const rows = tasks.map(t => ({ ...t, sheet_seen_at: runAt, sheet_removed_at: null }))
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supa.from('work_tasks').upsert(rows.slice(i, i + CHUNK), { onConflict: 'sheet_ref' })
    if (error) throw error
  }

  const { data: gone, error: goneErr } = await supa.from('work_tasks')
    .update({ sheet_removed_at: runAt })
    .eq('source', 'sheet').is('sheet_removed_at', null)
    .gte('due_date', from).lte('due_date', to)
    .or(`sheet_seen_at.is.null,sheet_seen_at.lt."${runAt}"`)
    .select('id')
  if (goneErr) throw goneErr

  return {
    found: tasks.length,
    added: tasks.filter(t => !existing.has(t.sheet_ref)).length,
    restored: tasks.filter(t => existing.get(t.sheet_ref)?.sheet_removed_at).length,
    removed: gone.length,
  }
}

export async function runSync(supa, { serviceAccount, sheetId, trigger }) {
  const { data: run } = await supa.from('worklog_sync_runs').insert({ trigger }).select('id').single()
  try {
    const token = await googleToken(serviceAccount)
    const rows = await fetchPlanRows(token, sheetId)
    const result = await writeTasks(supa, parseSheet(rows))
    if (run) await supa.from('worklog_sync_runs').update({ ...result, ok: true, finished_at: new Date().toISOString() }).eq('id', run.id)
    return { ok: true, ...result }
  } catch (e) {
    if (run) await supa.from('worklog_sync_runs').update({ ok: false, error: String(e.message || e), finished_at: new Date().toISOString() }).eq('id', run.id)
    throw e
  }
}
