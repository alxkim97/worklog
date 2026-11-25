import { adminClient, viewToken, sameToken } from '../lib/server.js'

// The secret view link (/?v=<token>, on Orbit's LINE cards): the plan,
// read-only, without signing in. GET /api/view?t=<token> returns the same
// rows the app loads (about 4 months back onward, plus your open tasks), the
// day notes and the last sync. The token lives in worklog_settings
// ('view_link'); Settings → View link makes a new one, which cancels the old.

const COLS = 'id,title,type,status,priority,start_date,due_date,lot_number,product_name,section,step,assignee,notes,source,sheet_ref,sheet_path,sheet_removed_at,done_at,created_at,updated_at'
const HISTORY_DAYS = 120

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return }
  res.setHeader('Cache-Control', 'no-store')
  try {
    const supa = adminClient()
    const token = await viewToken(supa)
    if (!token || !sameToken(String(req.query?.t || ''), token)) { res.status(403).json({ error: 'This view link has been replaced or switched off. Ask for the new one.' }); return }

    const since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10)
    const tasks = []
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supa.from('work_tasks').select(COLS)
        .is('sheet_removed_at', null)
        .or(`due_date.gte.${since},due_date.is.null,and(source.eq.manual,status.in.(pending,in_progress))`)
        .order('due_date', { ascending: true, nullsFirst: false }).order('id')
        .range(start, start + 999)
      if (error) throw error
      tasks.push(...data)
      if (data.length < 1000) break
    }
    const [{ data: notes }, { data: run }] = await Promise.all([
      supa.from('work_date_notes').select('*').gte('note_date', since).order('created_at'),
      supa.from('worklog_sync_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    res.status(200).json({ tasks, notes: notes || [], lastRun: run || null })
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) })
  }
}
