import { createClient } from '@supabase/supabase-js'
import { runSync } from '../lib/sheetSync.js'

// Pulls the production plan from Google Sheets into work_tasks.
// Callers:
//  - Vercel Cron (vercel.json): Authorization: Bearer <CRON_SECRET>
//  - the app's Sync button / sync-on-open: Authorization: Bearer <user JWT>,
//    accepted only for a row in worklog_members.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT (the
// key file's JSON), SHEET_ID, CRON_SECRET.

const MIN_GAP_MS = 2 * 60 * 1000 // repeat taps within this window reuse the last run

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).end(); return }
  const env = process.env
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_SERVICE_ACCOUNT', 'SHEET_ID']) {
    if (!env[k]) { res.status(500).json({ error: `${k} not set` }); return }
  }
  // Forgiving about pasted values: a URL copied with /rest/v1/ on the end
  // (v1's "Invalid path" bug) or trailing whitespace/newlines.
  const url = env.SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  const supa = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY.trim(), { auth: { persistSession: false } })

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  let trigger = null
  if (env.CRON_SECRET && bearer === env.CRON_SECRET.trim()) trigger = 'cron'
  else if (bearer) {
    const { data } = await supa.auth.getUser(bearer)
    if (data?.user) {
      const { data: member } = await supa.from('worklog_members').select('user_id').eq('user_id', data.user.id).maybeSingle()
      if (member) trigger = 'app'
    }
  }
  if (!trigger) { res.status(401).json({ error: 'unauthorized' }); return }

  if (trigger === 'app') {
    const { data: last } = await supa.from('worklog_sync_runs')
      .select('*').order('started_at', { ascending: false }).limit(1).maybeSingle()
    if (last && Date.now() - new Date(last.started_at).getTime() < MIN_GAP_MS) {
      res.status(200).json({ ok: last.ok !== false, reused: true, ...pick(last) })
      return
    }
  }

  try {
    const result = await runSync(supa, { serviceAccount: env.GOOGLE_SERVICE_ACCOUNT, sheetId: env.SHEET_ID.trim(), trigger })
    res.status(200).json(result)
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) })
  }
}

const pick = r => ({ found: r.found, added: r.added, removed: r.removed, restored: r.restored, error: r.error })
