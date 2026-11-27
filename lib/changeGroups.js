// Plan changes grouped by product + lot, one line per lot:
//   "3 steps pushed ~4 weeks · 16–22 Dec → 13–19 Jan"
// Input: change-log entries ({ kind, name, step, lot, from, to, id }).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayMs = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const fmt = s => `${+s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]}`

// "24 Nov", "24–30 Nov", "28 Nov–4 Dec"
export function dateRange(list) {
  const s = [...new Set(list.filter(Boolean))].sort()
  if (!s.length) return ''
  const a = s[0], z = s[s.length - 1]
  if (a === z) return fmt(a)
  return a.slice(0, 7) === z.slice(0, 7) ? `${+a.slice(8, 10)}–${fmt(z)}` : `${fmt(a)}–${fmt(z)}`
}

const span = days => days >= 12 ? `~${Math.round(days / 7)} weeks` : `${days} day${days === 1 ? '' : 's'}`
const what = list => list.length === 1 ? (list[0].step || '1 step') : `${list.length} steps`

export function describeGroup(items) {
  const moved = items.filter(c => c.kind === 'moved' && c.from && c.to)
  const added = items.filter(c => c.kind === 'added')
  const noted = items.filter(c => c.kind === 'note')
  const parts = []
  if (moved.length) {
    const shifts = moved.map(c => Math.round((dayMs(c.to) - dayMs(c.from)) / 86400000)).sort((x, y) => x - y)
    const mid = shifts[Math.floor(shifts.length / 2)]
    const dir = mid >= 0 ? 'pushed' : 'pulled in'
    parts.push(`${what(moved)} ${dir} ${span(Math.abs(mid))} · ${dateRange(moved.map(c => c.from))} → ${dateRange(moved.map(c => c.to))}`)
  }
  if (added.length) parts.push(`${what(added)} new on ${dateRange(added.map(c => c.to))}`)
  if (noted.length) parts.push(`${noted.length === 1 ? 'note' : `${noted.length} notes`} changed`)
  return parts.join(' · ')
}

// "Procoxib 120 3x10's (02) PV2" → { title: "Procoxib 120 3x10's (02)", pv: "PV2" }
export function splitPv(name) {
  const m = String(name || '').match(/\s*\bPV\s*(\d+)\b/i)
  return m ? { title: name.replace(m[0], '').trim(), pv: `PV${m[1]}` } : { title: name || '', pv: null }
}

export function groupChanges(changes) {
  const m = new Map()
  for (const c of changes) {
    const key = `${c.name}|${c.lot || ''}`
    if (!m.has(key)) m.set(key, { key, name: c.name, lot: c.lot || null, items: [] })
    m.get(key).items.push(c)
  }
  return [...m.values()].map(g => {
    const { title, pv } = splitPv(g.name)
    const lotShown = g.lot && !title.includes(`(${g.lot})`) ? g.lot : null
    const dates = g.items.map(c => c.to).filter(Boolean).sort()
    return { ...g, title, pv, lotShown, text: describeGroup(g.items), ids: g.items.map(c => c.id), firstTo: dates[0] || null }
  }).sort((a, b) => (a.firstTo || '').localeCompare(b.firstTo || ''))
}
