// LINE messages to Alex's phone (the phone PWA can't notify in the
// background). Only the desktop app sends — it's the one running all day and
// the one that fires reminders — so the phone and browser never double up.
// Texts that fire within a few seconds of each other (the 08:30 batch) go as
// one message. The server side is api/line-push.js.
import { state } from './store.js'

export const lineSender = () => typeof window !== 'undefined' && !!window.electronAPI && location.hash !== '#widget'
export const lineOn = () => lineSender() && state.prefs.line === true

export async function postLine(text) {
  // loaded on use: config.js reads `location`, which the Node tests don't have
  const [{ getSession }, { API_BASE }] = await Promise.all([import('./data.js'), import('./config.js')])
  const session = await getSession()
  const res = await fetch(`${API_BASE}/api/line-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ text }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `LINE failed (${res.status})`)
}

let queue = []
let timer = null
export function queueLine(text) {
  if (!lineOn()) return
  queue.push(text)
  clearTimeout(timer)
  timer = setTimeout(() => {
    const msg = queue.join('\n\n')
    queue = []
    postLine(`WorkLog\n${msg}`).catch(e => console.error('LINE:', e.message)) // best effort; the Windows notification already showed
  }, 4000)
}
