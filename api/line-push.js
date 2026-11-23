import { createClient } from '@supabase/supabase-js'

// Relays a reminder / plan-change text to Alex's LINE (Push API, one user —
// never Broadcast: the LINE account is shared with other apps' friends).
// Caller: the desktop app, Authorization: Bearer <user JWT>, accepted only
// for a row in worklog_members. Body: { text }.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LINE_CHANNEL_TOKEN (channel
// access token), LINE_USER_ID (LINE Developers → channel → Basic settings →
// "Your user ID"). The token lives only in Vercel, never in this public repo.

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return }
  const env = process.env
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) { res.status(500).json({ error: `${k} not set` }); return }
  }
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_USER_ID) { res.status(503).json({ error: 'LINE is not set up on the server yet (LINE_CHANNEL_TOKEN / LINE_USER_ID)' }); return }

  const url = env.SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  const supa = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY.trim(), { auth: { persistSession: false } })
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const { data } = bearer ? await supa.auth.getUser(bearer) : { data: null }
  const member = data?.user && (await supa.from('worklog_members').select('user_id').eq('user_id', data.user.id).maybeSingle()).data
  if (!member) { res.status(401).json({ error: 'unauthorized' }); return }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  const text = String(body.text || '').trim().slice(0, 4900)
  if (!text) { res.status(400).json({ error: 'empty message' }); return }

  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN.trim()}` },
    body: JSON.stringify({ to: env.LINE_USER_ID.trim(), messages: [{ type: 'text', text }] }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    res.status(502).json({ error: `LINE: ${err.message || r.status}` })
    return
  }
  res.status(200).json({ ok: true })
}
