import { adminClient, isMemberRequest, pushLine, lineReady, readBody } from '../lib/server.js'

// Relays a message from the desktop app to Alex's LINE (Push API, one user —
// never Broadcast: the LINE account is shared with other apps' friends).
// Caller: the desktop app, Authorization: Bearer <user JWT>, accepted only
// for a row in worklog_members.
// Body: { text } or { flex, altText } (a Flex bubble from lib/lineCards.js).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LINE_CHANNEL_TOKEN (channel
// access token), LINE_USER_ID (LINE Developers → channel → Basic settings →
// "Your user ID"). The token lives only in Vercel, never in this public repo.

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return }
  try {
    if (!lineReady()) { res.status(503).json({ error: 'LINE is not set up on the server yet (LINE_CHANNEL_TOKEN / LINE_USER_ID)' }); return }
    const supa = adminClient()
    if (!(await isMemberRequest(supa, req))) { res.status(401).json({ error: 'unauthorized' }); return }
    const body = readBody(req)
    let message
    if (body.flex && typeof body.flex === 'object') {
      if (JSON.stringify(body.flex).length > 28000) { res.status(400).json({ error: 'card too large' }); return }
      message = { type: 'flex', altText: String(body.altText || 'WorkLog').slice(0, 400), contents: body.flex }
    } else {
      const text = String(body.text || '').trim().slice(0, 4900)
      if (!text) { res.status(400).json({ error: 'empty message' }); return }
      message = { type: 'text', text }
    }
    await pushLine([message])
    res.status(200).json({ ok: true })
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) })
  }
}
