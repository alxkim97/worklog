import { adminClient, isCron, isMemberRequest } from '../lib/server.js'
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
  try {
    for (const k of ['GOOGLE_SERVICE_ACCOUNT', 'SHEET_ID']) {
      if (!process.env[k]) { res.status(500).json({ error: `${k} not set` }); return }
    }
    const supa = adminClient()
    const trigger = isCron(req) ? 'cron' : (await isMemberRequest(supa, req)) ? 'app' : null
    if (!trigger) { res.status(401).json({ error: 'unauthorized' }); return }

    if (trigger === 'app') {
      const { data: last } = await supa.from('worklog_sync_runs')
        .select('*').order('started_at', { ascending: false }).limit(1).maybeSingle()
      if (last && Date.now() - new Date(last.started_at).getTime() < MIN_GAP_MS) {
        res.status(200).json({ ok: last.ok !== false, reused: true, running: last.ok == null && !last.finished_at, ...pick(last) })
        return
      }
    }

    const result = await runSync(supa, { serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT, sheetId: process.env.SHEET_ID.trim(), trigger })
    res.status(200).json(result)
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: String(e.message || e) })
  }
}

const pick = r => ({ found: r.found, added: r.added, removed: r.removed, restored: r.restored, error: r.error })
