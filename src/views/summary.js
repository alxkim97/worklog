// R&D Summary page: what R&D got done in a month or a year, with counts by
// type and by product, printable to PDF. (The on-request Markdown report
// lives in report.js.)
import { state } from '../store.js'
import { fetchRange, historyStart } from '../data.js'
import { summarize, CATS } from '../summary.js'
import { today, addDays, addMonths, monthStart, monthYear, shortDate, fromStr } from '../dates.js'
import { deptColor, empty } from '../components.js'
import { esc, icon } from '../ui.js'

// ── Period ──
export const sumMode = () => (state.prefs.sumMode === 'year' ? 'year' : 'month')
export function period(cursor = state.sumCursor, mode = sumMode()) {
  if (mode === 'year') { const y = cursor.slice(0, 4); return { from: `${y}-01-01`, to: `${y}-12-31` } }
  const from = monthStart(cursor)
  return { from, to: addDays(addMonths(from, 1), -1) }
}
export const summaryTitle = () => (sumMode() === 'year' ? state.sumCursor.slice(0, 4) : monthYear(state.sumCursor))
export const moveSummary = dir => { state.sumCursor = sumMode() === 'year' ? `${Number(state.sumCursor.slice(0, 4)) + dir}-01-01` : addMonths(state.sumCursor, dir) }

// "WorkLog R&D Summary November 2026 (R.0_261123).pdf"
export function summaryFileName() {
  const t = today()
  return `WorkLog R&D Summary ${summaryTitle()} (R.0_${t.slice(2, 4)}${t.slice(5, 7)}${t.slice(8, 10)}).pdf`
}

// ── Data: the loaded window covers ~4 months; older periods are fetched once
// per period and merged under the loaded rows (local edits win). ──
const ready = new Map()   // key → tasks
const pending = new Map() // key → promise
export function tasksFor(from, to) {
  if (from >= historyStart()) return Promise.resolve(state.tasks)
  const k = `${from}|${to}`
  if (ready.has(k)) return Promise.resolve([...state.tasks, ...ready.get(k)])
  if (!pending.has(k)) {
    pending.set(k, fetchRange(from, to)
      .then(rows => { ready.set(k, rows); return rows })
      .finally(() => pending.delete(k)))
  }
  return pending.get(k).then(rows => [...state.tasks, ...rows])
}
// Synchronous view of the same: null while a fetch is still running.
function tasksNow(from, to, rerender) {
  if (from >= historyStart()) return state.tasks
  const k = `${from}|${to}`
  if (ready.has(k)) return [...state.tasks, ...ready.get(k)]
  if (failed.has(k) || pending.has(k)) return null
  tasksFor(from, to).then(
    () => { if (state.view === 'summary') rerender() },
    e => { failed.set(k, e.message || 'Could not load'); if (state.view === 'summary') rerender() })
  return null
}
const failed = new Map()
export const retrySummary = () => failed.clear()

// ── Rendering ──
const dm = d => shortDate(d)
const tile = (n, label, cls = '') => `<div class="sum-tile ${cls}"><b>${n}</b><span>${esc(label)}</span></div>`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function renderSummary({ rerender }) {
  const { from, to } = period()
  const k = `${from}|${to}`
  const tasks = tasksNow(from, to, rerender)
  const head = `<div class="print-head"><b>WorkLog · R&amp;D Summary · ${esc(summaryTitle())}</b><span>Alex Kim · printed ${esc(new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>`
  if (!tasks) {
    const err = failed.get(k)
    return `<div class="summary">${head}${err ? `${empty(`Couldn’t load ${summaryTitle()}: ${err}`, '⚠️')}<p class="sum-retry"><button class="btn soft small" data-act="sum-retry">Try again</button></p>` : `<div class="sum-loading">${icon('sync', 16)} Loading ${esc(summaryTitle())}…</div>`}</div>`
  }
  const s = summarize(tasks, from, to, today())
  const shown = CATS.filter(c => ['pv', 'rdline', 'rd_experiment', 'document', 'task'].includes(c.key) || s.counts[c.key])
  const future = from > today()
  return `
    <div class="summary">
      ${head}
      <div class="sum-tiles">
        ${tile(s.total, 'done in total', 'total')}
        ${shown.map(c => tile(s.counts[c.key], c.label, `c-${c.key}`)).join('')}
      </div>
      ${!s.total ? empty(future ? 'This period hasn’t happened yet.' : 'Nothing R&D finished in this period.', '🗂️') : `
        ${sumMode() === 'year' ? byMonthCard(s) : ''}
        <div class="sum-grid">
          ${[pvCard(s) + rdLineCard(s),
            ownCard('Experiments', '🧪', s.own.rd_experiment) + ownCard('Documents', '📄', s.own.document) + ownCard('Tasks', '✅', s.own.task) +
            ownCard('Meetings', '🗓️', s.own.meeting) + ownCard('PV prep (own tasks)', '🏷️', s.own.pv_lot),
          ].filter(Boolean).map(col => `<div class="sum-col">${col}</div>`).join('')}
        </div>`}
      <p class="muted small sum-foot">Counts R&amp;D work only: PV steps and R&amp;D-line runs from the production plan (done once their date has passed), and your own tasks on the day you marked them done.</p>
    </div>`
}

function byMonthCard(s) {
  const y = s.from.slice(0, 4)
  const rows = MONTHS.map((m, i) => {
    const key = `${y}-${String(i + 1).padStart(2, '0')}`
    const r = s.byMonth.find(x => x.month === key) || {}
    const total = CATS.reduce((a, c) => a + (r[c.key] || 0), 0)
    return { m, key, r, total }
  })
  const max = Math.max(1, ...rows.map(r => r.total))
  const cols = CATS.filter(c => s.counts[c.key])
  return `
    <section class="card sum-months">
      <header class="card-head"><h2>${icon('chart', 18)} By month</h2></header>
      <div class="table-wrap">
        <table class="sum-table">
          <thead><tr><th>Month</th>${cols.map(c => `<th class="num">${esc(c.short)}</th>`).join('')}<th class="num">Total</th><th class="bar-col"></th></tr></thead>
          <tbody>${rows.map(({ m, key, r, total }) => `
            <tr class="${total ? '' : 'zero'}">
              <td><button type="button" class="link" data-act="sum-month" data-date="${key}-01">${m}</button></td>
              ${cols.map(c => `<td class="num">${r[c.key] || ''}</td>`).join('')}
              <td class="num"><b>${total || '–'}</b></td>
              <td class="bar-col"><span class="sum-bar">${cols.map(c => r[c.key] ? `<i class="c-${c.key}" style="width:${(r[c.key] / max) * 100}%"></i>` : '').join('')}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`
}

function pvCard(s) {
  if (!s.pvLots.length) return ''
  const steps = s.pvLots.reduce((a, l) => a + l.steps.length, 0)
  return `
    <section class="card">
      <header class="card-head"><h2>${icon('flask', 18)} PV lots</h2><span class="muted small">${s.pvLots.length} lot${s.pvLots.length > 1 ? 's' : ''} · ${steps} step${steps > 1 ? 's' : ''}</span></header>
      <div class="sum-lots">
        ${s.pvLots.map(l => `
          <div class="sum-lot">
            <div class="sum-lot-head"><b>${esc(l.name)}</b>${l.lot ? `<span class="muted small">Lot ${esc(l.lot)}</span>` : ''}<span class="sum-count">${l.steps.length}</span></div>
            <div class="sum-steps">${l.steps.map(x => `<button type="button" class="sum-step" style="--c:${deptColor(x.section)}" data-act="open" data-id="${x.id}"><b>${esc(x.step || 'Step')}</b> ${esc(dm(x.day))}</button>`).join('')}</div>
          </div>`).join('')}
      </div>
    </section>`
}

function rdLineCard(s) {
  if (!s.rdLine.length) return ''
  return `
    <section class="card">
      <header class="card-head"><h2>${icon('factory', 18)} R&amp;D line</h2><span class="muted small">${s.counts.rdline} run${s.counts.rdline > 1 ? 's' : ''} · ${s.rdLine.length} product${s.rdLine.length > 1 ? 's' : ''}</span></header>
      <div class="sum-rows">
        ${s.rdLine.map(l => `
          <div class="sum-row">
            <span class="sum-what">${esc(l.name)}<span class="sum-when">${esc(l.runs.map(r => `${r.step ? `${r.step} ` : ''}${dm(r.day)}`).join(' · '))}</span></span>
            <span class="sum-count">${l.runs.length}</span>
          </div>`).join('')}
      </div>
    </section>`
}

function ownCard(title, emoji, items) {
  if (!items?.length) return ''
  return `
    <section class="card">
      <header class="card-head"><h2><span class="sum-emoji">${emoji}</span> ${esc(title)}</h2><span class="sum-count">${items.length}</span></header>
      <div class="sum-rows">
        ${items.map(x => `
          <button type="button" class="sum-row" data-act="open" data-id="${x.id}">
            <span class="sum-day">${esc(dm(x.day))}</span>
            <span class="sum-what">${esc(x.title)}${x.lot ? ` <span class="muted small">Lot ${esc(x.lot)}</span>` : ''}</span>
          </button>`).join('')}
      </div>
    </section>`
}

// For the Make report dialog: "23 Nov 2026" or "16–22 Nov 2026".
export function rangeLabel(from, to) {
  const f = d => fromStr(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  if (from === to) return f(from)
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${f(to)}`
  if (from.slice(0, 4) === to.slice(0, 4)) return `${fromStr(from).toLocaleString('en-GB', { day: 'numeric', month: 'short' })} – ${f(to)}`
  return `${f(from)} – ${f(to)}`
}
