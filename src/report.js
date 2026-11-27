// "Make report": a Markdown draft for a day or a range, made only when you
// ask (there is no automatic report). Done work comes from the same counting
// as the Summary page; plan steps dated up to and including today count, so
// an end-of-day report includes today's PV steps.
import { state, isTracked, isOpen, isRdLine, startOf } from './store.js'
import { summarize } from './summary.js'
import { tasksFor, rangeLabel } from './views/summary.js'
import { today, addDays, weekStart, monthStart, addMonths, shortDate, weekday } from './dates.js'
import { openModal, toast, icon } from './ui.js'
import { nameOf } from '../lib/rd.js'

const dd = d => `${weekday(d)} ${shortDate(d)}`

export async function buildReport(from, to) {
  const tasks = await tasksFor(from, to)
  const single = from === to
  const s = summarize(tasks, from, to, addDays(today(), 1))
  const when = d => (single ? '' : ` (${shortDate(d)})`)
  const L = []
  L.push(`# R&D work report — ${single ? dd(from) : rangeLabel(from, to)}`, '')
  L.push(`_Alex Kim · drafted ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} from WorkLog_`, '')

  L.push('## Done', '')
  if (!s.total) L.push('- Nothing recorded as done.', '')
  if (s.pvLots.length) {
    L.push('### PV lots')
    for (const l of s.pvLots) L.push(`- **${l.name}**${l.lot ? ` · Lot ${l.lot}` : ''} — ${l.steps.map(x => `${x.step || 'step'}${when(x.day)}`).join(', ')}`)
    L.push('')
  }
  if (s.rdLine.length) {
    L.push('### R&D line')
    for (const l of s.rdLine) L.push(`- ${l.name} — ${l.runs.map(r => `${r.step || 'run'}${when(r.day)}`).join(', ')}`)
    L.push('')
  }
  for (const [key, title] of [['rd_experiment', 'Experiments'], ['document', 'Documents'], ['task', 'Tasks'], ['meeting', 'Meetings'], ['pv_lot', 'PV preparation']]) {
    const items = s.own[key]
    if (!items.length) continue
    L.push(`### ${title}`)
    for (const x of items) L.push(`- ${x.title}${x.lot ? ` (Lot ${x.lot})` : ''}${when(x.day)}`)
    L.push('')
  }

  const doing = state.tasks.filter(t => t.source === 'manual' && t.status === 'in_progress')
  if (doing.length) {
    L.push('## In progress', '')
    for (const t of doing) L.push(`- ${t.title}${t.due_date ? ` — due ${shortDate(t.due_date)}` : ''}`)
    L.push('')
  }

  // Next 7 days after the report (or after today, for a past range).
  const base = to > today() ? to : today()
  const until = addDays(base, 7)
  const next = state.tasks
    .filter(t => t.due_date && (isTracked(t) ? isOpen(t) : isRdLine(t)) && startOf(t) > base && startOf(t) <= until)
    .sort((a, b) => startOf(a).localeCompare(startOf(b)) || nameOf(a).localeCompare(nameOf(b)))
  if (next.length) {
    L.push('## Coming up (next 7 days)', '')
    for (const t of next) {
      const kind = t.type === 'pv_lot' ? 'PV · ' : isRdLine(t) ? 'R&D line · ' : ''
      L.push(`- ${dd(startOf(t))} — ${kind}${nameOf(t)}${t.step ? ` · ${t.step}` : ''}${t.lot_number ? ` · Lot ${t.lot_number}` : ''}`)
    }
    L.push('')
  }

  const notes = state.notes.filter(n => n.note_date >= from && n.note_date <= to).sort((a, b) => a.note_date.localeCompare(b.note_date))
  if (notes.length) {
    L.push('## Notes', '')
    for (const n of notes) L.push(`- ${single ? '' : `${shortDate(n.note_date)}: `}${n.content}`)
    L.push('')
  }
  return L.join('\n').trim() + '\n'
}

// "WorkLog Report 23 Nov 2026 (R.0_261123).md"
const fileName = (from, to) => { const t = today(); return `WorkLog Report ${rangeLabel(from, to).replace(/[–]/g, '-')} (R.0_${t.slice(2, 4)}${t.slice(5, 7)}${t.slice(8, 10)}).md` }

export function openReport({ from = today(), to = today() } = {}) {
  const t = today()
  const presets = [
    ['Today', t, t],
    ['Yesterday', addDays(t, -1), addDays(t, -1)],
    ['This week', weekStart(t), t],
    ['Last week', addDays(weekStart(t), -7), addDays(weekStart(t), -1)],
    ['This month', monthStart(t), t],
    ['Last month', addMonths(t, -1), addDays(monthStart(t), -1)],
  ]
  const m = openModal(`
    <form class="editor report" novalidate>
      <header class="modal-head">
        <h2>${icon('doc', 20)} Make report</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </header>
      <div class="modal-body">
        <div class="choice">${presets.map(([l, a, b]) => `<button type="button" class="preset" data-from="${a}" data-to="${b}">${l}</button>`).join('')}</div>
        <div class="field-row">
          <label class="field">From<input type="date" name="from" value="${from}"></label>
          <label class="field">To<input type="date" name="to" value="${to}"></label>
          <button type="submit" class="btn primary">Make draft</button>
        </div>
        <textarea class="report-text" name="md" rows="14" placeholder="Pick a day or range, then Make draft. You can edit the draft before copying or saving it." spellcheck="false"></textarea>
        <p class="muted small">R&amp;D work only: PV steps and R&amp;D-line runs from the plan (up to today), your tasks marked done, what’s in progress, the next 7 days and day notes.</p>
      </div>
      <footer class="modal-foot">
        <span></span>
        <div class="row-gap">
          <button type="button" class="btn soft" data-copy disabled>${icon('copy', 16)} Copy</button>
          <button type="button" class="btn soft" data-save disabled>${icon('download', 16)} Save .md</button>
        </div>
      </footer>
    </form>`, { wide: true })
  const form = m.el.querySelector('form')
  const text = form.elements.md
  const btns = form.querySelectorAll('[data-copy],[data-save]')
  let made = null
  form.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
    form.elements.from.value = b.dataset.from
    form.elements.to.value = b.dataset.to
    form.requestSubmit()
  }))
  form.onsubmit = async e => {
    e.preventDefault()
    let a = form.elements.from.value || t, b = form.elements.to.value || a
    if (a > b) [a, b] = [b, a]
    const go = form.querySelector('[type=submit]')
    go.disabled = true; go.textContent = 'Making…'
    try {
      text.value = await buildReport(a, b)
      made = { a, b }
      btns.forEach(x => { x.disabled = false })
    } catch (err) { toast(err.message || 'Could not make the report') }
    go.disabled = false; go.textContent = 'Make draft'
  }
  form.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(text.value).then(() => toast('Copied — paste it anywhere'), () => toast('Couldn’t copy'))
  form.querySelector('[data-save]').onclick = () => {
    const url = URL.createObjectURL(new Blob([text.value], { type: 'text/markdown' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: fileName(made.a, made.b) })
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  form.requestSubmit() // today's draft straight away
  return m
}
