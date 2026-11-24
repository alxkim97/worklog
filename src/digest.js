// The daily R&D digest from the desktop app: at the reminder time (08:30) it
// shows a Windows pop-up built from the plan it has, and asks api/digest to
// send the LINE card (the server skips it if today's already went out, and
// sends it itself later in the morning if the PC was off). A late start after
// noon doesn't pop a morning digest.
import { state } from './store.js'
import { today } from './dates.js'
import { buildDigest, toPlain } from '../lib/messages.js'
import { notify } from './reminders.js'
import { lineSender, postDigest } from './line.js'

const KEY = 'wl_digest_day'

export function checkDigest() {
  if (!lineSender() || !state.loaded || !state.member) return
  const s = state.digest // undefined = not loaded yet, null = settings table missing (defaults apply)
  if (s === undefined || s?.daily === false) return
  const t = today()
  let last = null
  try { last = localStorage.getItem(KEY) } catch {}
  if (last === t) return
  const now = new Date()
  const [h, m] = (state.prefs.remindTime || '08:30').split(':').map(Number)
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + (m || 0) || now.getHours() >= 12) return
  try { localStorage.setItem(KEY, t) } catch {}
  const msg = buildDigest(state.tasks, t, { weekend: s?.weekend !== false })
  if (!msg) return
  const { title, body } = toPlain(msg)
  notify({ title, body, tag: `digest-${t}`, line: false })
  postDigest('auto').catch(e => console.error('digest:', e.message))
}

export function startDigest() {
  checkDigest()
  setInterval(checkDigest, 60_000)
}
