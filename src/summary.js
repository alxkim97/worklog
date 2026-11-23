// R&D Summary: what got done in a period. Only R&D's own work counts —
//   • PV steps from the plan (grouped by product + lot)
//   • R&D-line runs from the plan (grouped by product)
//   • your own tasks by type (experiments, documents, tasks, meetings, PV prep)
// Plan rows count as done on their date once it has passed (nobody ticks
// them; a step you marked done early counts on its date too). Your own tasks
// count on the day they were marked done (done_at).
// Pure functions (no state import) so they can be tested in Node.

const isSheet = t => t.source === 'sheet'
const isRdLine = t => isSheet(t) && (t.sheet_path || '').includes('R&D line')
const pad = n => String(n).padStart(2, '0')
const localDay = iso => { if (!iso) return null; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const cleanName = t => (t.product_name || t.title || '').replace(/^[^A-Za-z0-9]+/, '').trim()

export const CATS = [
  { key: 'pv', label: 'PV steps', short: 'PV' },
  { key: 'rdline', label: 'R&D-line runs', short: 'R&D line' },
  { key: 'rd_experiment', label: 'Experiments', short: 'Exp.' },
  { key: 'document', label: 'Documents', short: 'Docs' },
  { key: 'task', label: 'Tasks', short: 'Tasks' },
  { key: 'meeting', label: 'Meetings', short: 'Meet.' },
  { key: 'pv_lot', label: 'PV prep (own)', short: 'PV prep' },
]

// { cat, day } for a task that counts as done, else null.
export function doneEntry(t, todayStr) {
  if (isSheet(t)) {
    const cat = t.type === 'pv_lot' ? 'pv' : isRdLine(t) ? 'rdline' : null
    if (!cat || !t.due_date || t.status === 'deferred' || t.sheet_removed_at) return null
    const done = t.status === 'done' || (t.status === 'pending' && t.due_date < todayStr)
    return done ? { cat, day: t.due_date } : null
  }
  if (t.status !== 'done') return null
  const day = localDay(t.done_at || t.updated_at) || t.due_date
  return day ? { cat: CATS.some(c => c.key === t.type) ? t.type : 'task', day } : null
}

export function summarize(tasks, from, to, todayStr) {
  const counts = Object.fromEntries(CATS.map(c => [c.key, 0]))
  const lots = new Map()
  const lines = new Map()
  const own = Object.fromEntries(CATS.filter(c => c.key !== 'pv' && c.key !== 'rdline').map(c => [c.key, []]))
  const byMonth = new Map()
  const seen = new Set()
  for (const t of tasks) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    const e = doneEntry(t, todayStr)
    if (!e || e.day < from || e.day > to) continue
    counts[e.cat]++
    const m = e.day.slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, Object.fromEntries(CATS.map(c => [c.key, 0])))
    byMonth.get(m)[e.cat]++
    if (e.cat === 'pv') {
      const name = cleanName(t)
      const key = `${name}|${t.lot_number || ''}`
      if (!lots.has(key)) lots.set(key, { name, lot: t.lot_number || null, steps: [] })
      lots.get(key).steps.push({ id: t.id, step: t.step || null, section: t.section, day: e.day })
    } else if (e.cat === 'rdline') {
      const name = cleanName(t)
      if (!lines.has(name)) lines.set(name, { name, runs: [] })
      lines.get(name).runs.push({ id: t.id, step: t.step || null, day: e.day })
    } else {
      own[e.cat].push({ id: t.id, title: t.title, lot: t.lot_number || null, day: e.day })
    }
  }
  const byDay = (a, b) => a.day.localeCompare(b.day)
  const pvLots = [...lots.values()].map(l => ({ ...l, steps: l.steps.sort(byDay) }))
    .sort((a, b) => a.steps[0].day.localeCompare(b.steps[0].day) || a.name.localeCompare(b.name))
  const rdLine = [...lines.values()].map(l => ({ ...l, runs: l.runs.sort(byDay) }))
    .sort((a, b) => b.runs.length - a.runs.length || a.name.localeCompare(b.name))
  for (const k of Object.keys(own)) own[k].sort(byDay)
  return {
    from, to, counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    pvLots, rdLine, own,
    byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, c]) => ({ month, ...c })),
  }
}
