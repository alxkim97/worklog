// Server-only helpers for api/*: Supabase with the service role, the member
// check for app callers, LINE Push, and Bangkok's date. Node (Vercel) only.
import { createClient } from '@supabase/supabase-js'

export function adminClient() {
  const env = process.env
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (!env[k]) throw Object.assign(new Error(`${k} not set`), { status: 500 })
  const url = env.SUPABASE_URL.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  return createClient(url, env.SUPABASE_SERVICE_ROLE_KEY.trim(), { auth: { persistSession: false } })
}

export const bearerOf = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
export const isCron = req => !!process.env.CRON_SECRET && bearerOf(req) === process.env.CRON_SECRET.trim()

// A signed-in WorkLog member (the app calling with its session token)?
export async function isMemberRequest(supa, req) {
  const bearer = bearerOf(req)
  if (!bearer) return false
  const { data } = await supa.auth.getUser(bearer)
  if (!data?.user) return false
  const { data: m } = await supa.from('worklog_members').select('user_id').eq('user_id', data.user.id).maybeSingle()
  return !!m
}

export const lineReady = () => !!(process.env.LINE_CHANNEL_TOKEN && process.env.LINE_USER_ID)

// Push to Alex only — never Broadcast: the LINE account is shared with other
// apps whose friends must not get these.
export async function pushLine(messages) {
  if (!lineReady()) throw Object.assign(new Error('LINE is not set up on the server yet (LINE_CHANNEL_TOKEN / LINE_USER_ID)'), { status: 503 })
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN.trim()}` },
    body: JSON.stringify({ to: process.env.LINE_USER_ID.trim(), messages }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    const detail = err.details?.map(d => `${d.property}: ${d.message}`).join('; ')
    throw Object.assign(new Error(`LINE: ${err.message || r.status}${detail ? ` (${detail})` : ''}`), { status: 502 })
  }
}

// 'YYYY-MM-DD' in Bangkok (the server runs in UTC).
export const bangkokToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

// ── The secret view link (worklog_settings 'view_link' { token }) ──
export const WEB = 'https://worklog-mauve.vercel.app'
export async function viewToken(supa) {
  const { data, error } = await supa.from('worklog_settings').select('value').eq('key', 'view_link').maybeSingle()
  const t = !error && data?.value?.token
  return typeof t === 'string' && t.length >= 24 ? t : null
}
// What "Open WorkLog (view)" on a card points at: the no-login link when one
// exists, else the signed-in read-only app in the phone's own browser.
export async function viewUrl(supa) {
  const t = await viewToken(supa).catch(() => null)
  return t ? `${WEB}/?v=${t}` : `${WEB}/?view=1&openExternalBrowser=1`
}
// Points every card button at viewUrl (the app builds cards without the token).
export function relink(node, url) {
  if (Array.isArray(node)) return node.forEach(n => relink(n, url))
  if (!node || typeof node !== 'object') return
  if (node.type === 'uri' && typeof node.uri === 'string' && node.uri.startsWith(WEB)) node.uri = url
  Object.values(node).forEach(v => relink(v, url))
}
// Constant-time compare for the token.
export function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export const readBody = req => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}))
