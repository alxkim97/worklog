// The messages Orbit (LINE) and the Windows pop-ups carry, built once as a
// plain model and rendered two ways: a LINE card (lib/lineCards.js) and plain
// text for the pop-up. Shared by the desktop app and api/digest.
//
// Model: { title, subtitle, sections: [{ label?, title?, rows }], note?, alt }
// A row is one of:
//   { bold, sub?, tone? }        bold line, small detail line(s) under it
//   { lead, bold, tag, tone }    one line: step · bold date · coloured tag
//   { text, tone? }              plain line
// tone: 'good' | 'bad' | 'warn' | 'muted'
import { addDays, weekday, weekdayLong, shortDate, fromStr } from '../src/dates.js'
import { rdDay, nameOf, isOwn, isOpen, startOf } from './rd.js'

const dd = d => `${weekday(d)} ${shortDate(d)}`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const TYPE = { rd_experiment: 'Experiment', document: 'Document', task: 'Task', pv_lot: 'PV prep', meeting: 'Meeting' }
// 'BANOCINORAL 50x1g (04) PV1' → 'BANOCINORAL 50x1g' for the busy lines
const shortName = t => nameOf(t).replace(/\s*\(.*$/, '') || nameOf(t)
// What happens: the sheet's step, or the department when a row has none
// (dispensing rows never do) — "Mix · Cream", "Dispensing".
const DEPT = { disp: 'Dispensing', tablets: 'Tablets', cream: 'Cream', liquid: 'Liquid', packing: 'Packing', rd: 'R&D' }
const what = t => [t.step, DEPT[t.section]].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ')
const stepOf = t => `${shortName(t)}${what(t) ? ` · ${t.step || DEPT[t.section]}` : ''}`
const detail = (...bits) => bits.filter(Boolean).join(' · ') || undefined

// ── Plain text (Windows pop-up) ──
export function toPlain(m) {
  const lines = []
  if (m.subtitle) lines.push(m.subtitle)
  for (const s of m.sections) {
    if (s.label || s.title) lines.push(s.title || s.label.toUpperCase())
    for (const r of s.rows) {
      const main = [r.lead, r.bold, r.tag, r.text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
      lines.push(`${s.title ? '  ' : '• '}${main}${r.sub ? ` — ${r.sub.replace(/\n/g, ', ')}` : ''}`)
    }
  }
  if (m.note) lines.push(m.note)
  return { title: m.title, body: lines.join('\n') }
}

// ── Daily digest ──
const WEEKEND = [
  'Enjoy your weekend 🌿', 'Weekend mode on ☀️', 'Time to recharge 🔋', 'Have an easy weekend ☕',
  'Rest up, see you Monday 🌙', 'Slow morning, good weekend 🍃', 'Off the clock today 🎈',
]
const daySerial = d => Math.round(fromStr(d).getTime() / 86400000)

const clashRow = c => ({
  bold: c.kind === 'pv-pv' ? `${c.tasks.length} PV steps at once` : 'PV step + R&D-line run',
  sub: c.tasks.map(stepOf).join('\n'),
  tone: 'warn',
})

function daySections(x) {
  const sections = []
  if (x.pv.length) sections.push({ label: 'PV steps', rows: x.pv.map(t => ({ bold: nameOf(t), sub: detail(what(t), t.lot_number && `Lot ${t.lot_number}`) })) })
  if (x.rdLine.length) sections.push({ label: 'R&D line', rows: x.rdLine.map(t => ({ bold: nameOf(t), sub: detail(what(t)) })) })
  if (x.tasks.length) sections.push({ label: 'Your tasks', rows: x.tasks.map(t => ({ bold: t.title, sub: detail(TYPE[t.type] !== 'Task' && TYPE[t.type], t.start_date && t.start_date < t.due_date && `until ${dd(t.due_date)}`) })) })
  if (x.meetings.length) sections.push({ label: 'Meetings', rows: x.meetings.map(t => ({ bold: t.title })) })
  if (x.clashes.length) sections.push({ label: '⚠ Clash', rows: x.clashes.map(clashRow) })
  return sections
}
const counts = x => [
  x.pv.length && plural(x.pv.length, 'PV step'),
  x.rdLine.length && plural(x.rdLine.length, 'R&D-line run'),
  x.tasks.length && plural(x.tasks.length, 'task'),
  x.meetings.length && plural(x.meetings.length, 'meeting'),
].filter(Boolean)
const isEmpty = x => !x.pv.length && !x.rdLine.length && !x.tasks.length && !x.meetings.length

// tasks: work_tasks rows; today: 'YYYY-MM-DD' (Bangkok). Returns the model,
// or null when nothing should go out (weekend message switched off).
export function buildDigest(tasks, today, { weekend = true } = {}) {
  const dow = fromStr(today).getDay()
  const x = rdDay(tasks, today)
  const overdue = tasks.filter(t => isOwn(t) && isOpen(t) && t.due_date && t.due_date < today && !t.sheet_removed_at)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  if (dow === 0 || dow === 6) {
    if (!weekend) return null
    const title = WEEKEND[daySerial(today) % WEEKEND.length]
    return {
      title, subtitle: `${weekdayLong(today)} ${shortDate(today)}`, sections: daySections(x),
      note: isEmpty(x) ? 'Nothing planned for R&D today.' : null,
      alt: isEmpty(x) ? `${title} · nothing planned for R&D` : `${title} · ${counts(x).join(', ')} today`,
    }
  }

  const sections = daySections(x)
  if (overdue.length) sections.push({ label: 'Overdue', rows: overdue.slice(0, 8).map(t => ({ bold: t.title, sub: `was due ${dd(t.due_date)}`, tone: 'bad' })) })
  // Monday: the rest of the week, each day with its items on their own lines.
  if (dow === 1) {
    const rows = []
    for (let i = 1; i <= 6; i++) {
      const d = addDays(today, i)
      const y = rdDay(tasks, d)
      // a task spanning several days shows once, on the day it's due
      y.tasks = y.tasks.filter(t => t.due_date === d)
      if (isEmpty(y)) continue
      const lines = [
        ...y.pv.map(t => `PV  ${stepOf(t)}`),
        ...y.rdLine.map(t => `R&D line  ${stepOf(t)}`),
        ...y.tasks.map(t => t.title),
        ...y.meetings.map(t => `Meeting  ${t.title}`),
        ...(y.clashes.length ? ['⚠ Clash'] : []),
      ]
      rows.push({ bold: dd(d), sub: lines.join('\n') })
    }
    sections.push({ label: 'Week ahead', rows: rows.length ? rows : [{ text: 'Nothing else planned for R&D this week.', tone: 'muted' }] })
  }
  const c = counts(x)
  // The phone's notification shows only this line: say what, not just how many.
  const items = [...x.pv.map(t => `PV ${stepOf(t)}`), ...x.rdLine.map(t => `R&D line ${stepOf(t)}`), ...x.tasks.map(t => t.title), ...x.meetings.map(t => t.title)]
  const first = items.length ? `${items[0]}${items.length > 1 ? ` +${items.length - 1} more` : ''}` : 'nothing on the R&D plan'
  return {
    title: `Today · ${dd(today)}`,
    subtitle: c.length ? c.join(' · ') : 'A clear day for R&D',
    sections,
    note: isEmpty(x) && !overdue.length && dow !== 1 ? 'Nothing on the R&D plan today.' : null,
    alt: `Today: ${first}${x.clashes.length ? ' · ⚠ clash' : ''}${overdue.length ? ` · ${overdue.length} overdue` : ''}`,
  }
}

// ── Plan changes ──
// changes: from src/planChanges.js diffPlan(). Ones within `within` days are
// listed, grouped by product; later ones become a single line.
export function planChangeMessage(changes, today, { within = 14 } = {}) {
  const limit = addDays(today, within)
  const when = c => c.to || c.from
  const near = changes.filter(c => when(c) <= limit)
  const far = changes.filter(c => when(c) > limit)
  const groups = new Map()
  for (const c of near.sort((a, b) => when(a).localeCompare(when(b)))) {
    const k = `${c.name}|${c.lot || ''}`
    if (!groups.has(k)) groups.set(k, { title: c.name, rows: [] })
    const lead = c.step || 'Step'
    groups.get(k).rows.push(
      c.kind === 'moved' ? { lead, bold: `${dd(c.from)} → ${dd(c.to)}`, tag: 'moved', tone: 'warn' }
        : c.kind === 'removed' ? { lead, bold: dd(c.from), tag: 'removed', tone: 'bad' }
          : { lead, bold: dd(c.to), tag: 'new', tone: 'good' })
  }
  const lastFar = far.map(when).sort().pop()
  const farLine = far.length ? `+${plural(far.length, 'more change')} after ${dd(limit)}${lastFar ? ` (up to ${shortDate(lastFar)})` : ''} — see WorkLog` : null
  const products = groups.size
  return {
    title: 'Plan changed',
    subtitle: near.length ? `${plural(near.length, 'R&D step')} · next ${within} days` : `Later than ${within} days`,
    sections: [...groups.values()],
    note: farLine,
    alt: near.length ? `Plan changed: ${plural(near.length, 'R&D step')}${products > 1 ? ` in ${products} products` : ''} in the next ${within} days` : `Plan changed: ${plural(far.length, 'step')} after ${dd(limit)}`,
  }
}

// ── Reminders (per task, from reminders.js) ──
// items: [{ title, body }] fired together.
export function reminderMessage(items) {
  return {
    title: items.length > 1 ? `${items.length} reminders` : 'Reminder',
    subtitle: null,
    sections: [{ rows: items.map(i => ({ bold: i.title, sub: i.body })) }],
    note: null,
    alt: items.length > 1 ? `${items.length} reminders: ${items.map(i => i.title).join(' · ')}` : `${items[0].title} — ${items[0].body}`,
  }
}

export { dd as dayLabel, startOf }
