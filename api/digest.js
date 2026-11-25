import { adminClient, isCron, isMemberRequest, pushLine, bangkokToday, readBody, viewUrl } from '../lib/server.js'
import { buildDigest } from '../lib/messages.js'
import { flexMessage } from '../lib/lineCards.js'
import { addDays } from '../src/dates.js'

// The 08:30 R&D digest on LINE (today's PV steps, R&D-line runs, your tasks,
// clashes, overdue; Mondays add the week ahead; weekends a short "enjoy your
// weekend" note unless switched off).
// Callers:
//  - the desktop app at 08:30 (Bearer <user JWT>), body { mode: 'auto' }:
//    sends unless today's digest already went out; { mode: 'test' } always sends.
//  - Vercel Cron (Bearer CRON_SECRET, vercel.json), a fallback for days the PC
//    is off: sends only if nothing went out yet today. (Hobby cron runs some
//    time within its hour, so it's scheduled after 08:30, not at it.)
// Settings: worklog_settings rows 'digest' { daily, weekend } (the app's
// switches) and 'digest_sent' { day } (written here). SETUP.md part F.

const BASE_COLS = 'id,title,type,status,priority,start_date,due_date,lot_number,product_name,section,step,source,sheet_path,sheet_removed_at'

async function setting(supa, key) {
  const { data, error } = await supa.from('worklog_settings').select('value').eq('key', key).maybeSingle()
  if (error) return { missing: true }
  return data?.value || {}
}

async function rdTasks(supa, today) {
  const out = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supa.from('work_tasks').select(BASE_COLS)
      .is('sheet_removed_at', null)
      .or(`and(due_date.gte.${today},due_date.lte.${addDays(today, 7)}),and(source.eq.manual,status.in.(pending,in_progress))`)
      .order('id').range(start, start + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).end(); return }
  try {
    const supa = adminClient()
    const cron = isCron(req)
    if (!cron && !(await isMemberRequest(supa, req))) { res.status(401).json({ error: 'unauthorized' }); return }
    const mode = cron ? 'auto' : (readBody(req).mode === 'test' ? 'test' : 'auto')
    const today = bangkokToday()

    const prefs = await setting(supa, 'digest')
    const sent = await setting(supa, 'digest_sent')
    if (mode === 'auto') {
      // Without the settings table the server can't tell whether the PC
      // already sent today, so the cron stays quiet rather than double up.
      if (cron && prefs.missing) { res.status(200).json({ sent: false, reason: 'settings table missing (SETUP.md part F)' }); return }
      if (prefs.daily === false) { res.status(200).json({ sent: false, reason: 'daily digest is off' }); return }
      if (sent.day === today) { res.status(200).json({ sent: false, reason: 'already sent today' }); return }
    }

    const m = buildDigest(await rdTasks(supa, today), today, { weekend: mode === 'test' || prefs.weekend !== false })
    if (!m) { res.status(200).json({ sent: false, reason: 'weekend message is off' }); return }
    await pushLine([flexMessage(m, { link: await viewUrl(supa) })])
    if (mode === 'auto' && !prefs.missing) {
      await supa.from('worklog_settings').upsert({ key: 'digest_sent', value: { day: today, at: new Date().toISOString(), by: cron ? 'cron' : 'app' }, updated_at: new Date().toISOString() })
    }
    res.status(200).json({ sent: true, day: today, title: m.title })
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) })
  }
}
