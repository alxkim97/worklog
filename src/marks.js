// Change signs on the calendar: a step that moved, appeared or got a new
// sheet note wears an amber ring until you open it (hover a moment, or click),
// and any you never open fade out after 7 days. "Clear all" empties the log.
import { loadChanges } from './planChanges.js'

const SEEN_KEY = 'wl_change_seen'
const MARK_DAYS = 7
const KINDS = new Set(['moved', 'added', 'note'])

const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const keyOf = c => `${c.id}|${c.at}`

let cache = null
// id → the newest unseen change for that row: { kind, from, to, at }
export function marks() {
  if (cache) return cache
  const cutoff = Date.now() - MARK_DAYS * 86400000
  const seen = readSeen()
  cache = new Map()
  for (const c of loadChanges()) {
    if (!c.id || !KINDS.has(c.kind) || new Date(c.at) < cutoff || seen.has(keyOf(c)) || cache.has(c.id)) continue
    cache.set(c.id, c)
  }
  return cache
}
export const resetMarks = () => { cache = null }
export const markOf = id => marks().get(id) || null

// Opened: every logged change of that row counts as seen. true = one was showing.
export function markSeen(id) {
  const all = loadChanges().filter(c => c.id === id)
  if (!all.length) return false
  const seen = readSeen()
  const had = !!markOf(id)
  all.forEach(c => seen.add(keyOf(c)))
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300))) } catch {}
  cache = null
  return had
}

export const MARK_LABEL = { moved: 'moved', added: 'new', note: 'note' }
