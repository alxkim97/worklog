// LINE ("Orbit") from the app. Only the desktop app sends — it's the one
// running all day and the one that fires reminders — so the phone and browser
// never double up. Everything goes out as a card (lib/lineCards.js) through
// api/line-push; the daily digest is built and sent by api/digest.
import { state } from './store.js'
import { flexMessage } from '../lib/lineCards.js'
import { reminderMessage, planChangeMessage } from '../lib/messages.js'
import { today } from './dates.js'

export const lineSender = () => typeof window !== 'undefined' && !!window.electronAPI && location.hash !== '#widget'
export const lineOn = () => lineSender() && state.prefs.line === true

async function api(path, body) {
  // loaded on use: config.js reads `location`, which the Node tests don't have
  const [{ getSession }, { API_BASE }] = await Promise.all([import('./data.js'), import('./config.js')])
  const session = await getSession()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || `LINE failed (${res.status})`)
  return out
}

export const postLine = text => api('/api/line-push', { text })
export function postCard(model) {
  const msg = flexMessage(model)
  return api('/api/line-push', { flex: msg.contents, altText: msg.altText })
}
// The daily digest: mode 'auto' (sent once a day) or 'test' (always).
export const postDigest = mode => api('/api/digest', { mode })

// Reminders that fire within a few seconds of each other (the 08:30 batch)
// go as one card.
let queue = []
let timer = null
export function queueLine(title, body) {
  if (!lineOn()) return
  queue.push({ title, body })
  clearTimeout(timer)
  timer = setTimeout(() => {
    const items = queue
    queue = []
    postCard(reminderMessage(items)).catch(e => console.error('LINE:', e.message)) // best effort; the Windows pop-up already showed
  }, 4000)
}

export function lineChanges(changes) {
  if (!lineOn() || !changes.length) return
  postCard(planChangeMessage(changes, today())).catch(e => console.error('LINE:', e.message))
}
