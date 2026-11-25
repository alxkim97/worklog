// `npm run demo` swaps this in for data.js (vite.config.js alias): same
// exports, fake in-memory data — for design work without touching Supabase.
import { today, addDays, isWeekend } from './dates.js'

const user = { id: 'demo-user', email: 'alex@apm.demo' }
const session = { user, access_token: 'demo' }
let n = 0
const id = () => `demo-${++n}`
const now = () => new Date().toISOString()

const PRODUCTS = {
  tablets: ['Ramol 500 mg film-coated', 'Ramol OVAL 650 mg', 'TC-mycin 250 mg capsule', 'P-400 500 mg tablet', 'Zarium 10 mg dispersible', 'Banocin 5 mg powder sachet'],
  cream: ['MASAGA SSS cream 30 g', 'Banocinoral gel 5 g tube', 'Polycin ointment 10 g'],
  liquid: ['Machto Gel PET 240 mL', 'Hashi syrup 60 mL', 'Dimophen syrup 60 mL'],
  disp: ['MASAGA SSS (12)', 'TC-mycin 2×5 g (31)', 'Polycin ointment (07)', 'DIMOPHEN DS (18)'],
  packing: ['Hashi syrup bottle line', 'TC-mycin strip 10×10'],
}
const STEPS = { tablets: ['Mix', 'Tab', 'Coat', 'Blister'], cream: ['Mix', 'Bottle'], liquid: ['Mix', 'Bottle'] }

function build() {
  const t = today()
  const tasks = []
  const pick = (arr, i) => arr[i % arr.length]
  for (let d = -21; d <= 35; d++) {
    const date = addDays(t, d)
    if (isWeekend(date)) continue
    let k = Math.abs(d * 7 + 3)
    for (const dept of ['disp', 'tablets', 'cream', 'liquid', 'packing']) {
      const count = dept === 'tablets' ? 3 : dept === 'packing' ? 1 : 2
      for (let i = 0; i < count; i++) {
        const product = pick(PRODUCTS[dept], k++)
        const step = STEPS[dept] ? pick(STEPS[dept], k + i) : null
        tasks.push({
          id: id(), source: 'sheet', type: 'production', status: 'pending', priority: 'normal',
          title: step ? `[${step}] ${product}` : product, product_name: product, section: dept, step,
          due_date: date, start_date: null, lot_number: (product.match(/\((\d+)\)/) || [])[1] || null,
          sheet_ref: `${date}|${dept}|${step || ''}|${product}|${i}`, sheet_path: `${dept[0].toUpperCase() + dept.slice(1)} › ${dept === 'liquid' && i === 0 && d % 3 === 0 ? 'R&D line › ' : ''}${step || 'Disp'}`,
          notes: null, created_at: now(), updated_at: now(),
        })
      }
    }
  }
  // PV lots: one product through its steps over a couple of weeks.
  const lots = [
    { name: 'BANOCINORAL 50×1g (04) PV1', lot: '101', dept: 'tablets', start: -8, steps: ['Mix', 'Tab', 'Coat', 'Blister'] },
    { name: 'Machto Gel PET 240mL PV1', lot: '114', dept: 'tablets', start: 1, steps: ['Mix', 'Tab', 'Blister'] },
    { name: 'Polycin ointment 10 g PV2', lot: '205', dept: 'cream', start: -3, steps: ['Mix', 'Bottle'] },
  ]
  for (const l of lots) {
    l.steps.forEach((step, i) => {
      const date = addDays(t, l.start + i * 3)
      tasks.push({
        id: id(), source: 'sheet', type: 'pv_lot', status: date < t ? 'done' : 'pending', priority: 'normal',
        title: `[${step}] ${l.name}`, product_name: l.name, section: l.dept, step, due_date: date, lot_number: l.lot,
        sheet_ref: `${date}|${l.dept}|${step}|${l.name}`, sheet_path: `${l.dept} › ${step}`, notes: null, created_at: now(), updated_at: now(),
      })
    })
  }
  const mine = [
    { title: 'Dissolution test — Para 500 batch 31', type: 'rd_experiment', due: 0, status: 'in_progress', priority: 'high', lot: '31' },
    { title: 'Review stability protocol v3', type: 'document', due: 0 },
    { title: 'R&D weekly sync', type: 'meeting', due: 0, status: 'done' },
    { title: 'Send COA request to supplier', type: 'task', due: -2, priority: 'critical' },
    { title: 'Update SOP-RD-014 with new pH range', type: 'document', due: -1 },
    { title: 'Order HPLC columns', type: 'task', due: 1, remind: 0 },
    { title: 'Vitamin C coating trial', type: 'rd_experiment', due: 4, start: 2, lot: 'T-07' },
    { title: 'Prepare PV2 Cetirizine sampling plan', type: 'pv_lot', due: 2, priority: 'high' },
    { title: 'Monthly report draft', type: 'document', due: 6 },
    { title: 'Supplier audit prep', type: 'meeting', due: 9 },
    { title: 'Read FDA guidance on nitrosamines', type: 'task', due: null },
  ]
  for (const m of mine) {
    tasks.push({
      id: id(), source: 'manual', type: m.type, status: m.status || 'pending', priority: m.priority || 'normal',
      title: m.title, section: 'rd', due_date: m.due == null ? null : addDays(t, m.due), start_date: m.start != null ? addDays(t, m.start) : null,
      lot_number: m.lot || null, remind_days: m.remind ?? null, notes: m.type === 'rd_experiment' ? 'Use apparatus 2, 50 rpm.' : null, created_at: now(), updated_at: now(),
      done_at: m.status === 'done' ? now() : null,
    })
  }
  // Finished history for the R&D Summary (months back, past the 120-day window too).
  const history = [
    ['Dissolution profile — Ramol 500 f-c', 'rd_experiment', -3], ['Update SOP-RD-011 sampling', 'document', -5], ['Order reference standards', 'task', -6],
    ['Coating trial T-05', 'rd_experiment', -9], ['PV1 protocol — Machto Gel', 'document', -12], ['R&D weekly sync', 'meeting', -7], ['R&D weekly sync', 'meeting', -14],
    ['Hardness study Zarium 10 mg', 'rd_experiment', -18], ['Calibrate dissolution bath', 'task', -20], ['Stability report Q3', 'document', -33],
    ['Granulation end-point trial', 'rd_experiment', -40], ['PV2 report — Banocin', 'document', -47], ['Supplier CoA review', 'task', -52],
    ['Taste-masking trial Hashi', 'rd_experiment', -75], ['Method transfer HPLC', 'document', -96], ['Excipient compatibility', 'rd_experiment', -130],
    ['Annual product review input', 'document', -160], ['Scale-up trial Polycin', 'rd_experiment', -200], ['R&D budget plan', 'task', -250],
  ]
  for (const [title, type, d] of history) {
    const day = addDays(t, d)
    tasks.push({ id: id(), source: 'manual', type, status: 'done', priority: 'normal', title, section: 'rd', due_date: day, start_date: null,
      lot_number: null, notes: null, created_at: now(), updated_at: now(), done_at: `${day}T10:00:00` })
  }
  const oldLots = [
    { name: 'Zarium 10 mg dispersible PV1', lot: '088', dept: 'tablets', start: -64, steps: ['Mix', 'Tab', 'Blister'] },
    { name: 'Hashi syrup 60 mL PV3', lot: '072', dept: 'liquid', start: -150, steps: ['Mix', 'Fill Liquid', 'Bottle'] },
  ]
  for (const l of oldLots) l.steps.forEach((step, i) => {
    const date = addDays(t, l.start + i * 2)
    tasks.push({ id: id(), source: 'sheet', type: 'pv_lot', status: 'done', auto_done: true, priority: 'normal', title: `[${step}] ${l.name}`, product_name: l.name,
      section: l.dept, step, due_date: date, lot_number: l.lot, sheet_ref: `${date}|${l.dept}|${step}|${l.name}`, sheet_path: `${l.dept} › ${step}`, notes: null, created_at: now(), updated_at: now() })
  })
  return tasks
}

let tasks = build()
let notes = [
  { id: id(), note_date: today(), content: 'QA audit on the floor 2–4pm — keep the lab tidy', category: 'plan', created_at: now() },
  { id: id(), note_date: addDays(today(), 3), content: 'Public holiday next Monday?', category: 'plan', created_at: now() },
]
const lastRun = { id: 1, ok: true, started_at: new Date(Date.now() - 25 * 60000).toISOString(), finished_at: new Date(Date.now() - 25 * 60000).toISOString(), added: 4, removed: 1 }
const wait = (ms = 120) => new Promise(r => setTimeout(r, ms))
const copy = x => JSON.parse(JSON.stringify(x))

export const supa = null
export const remindColumnReady = () => true
export const checklistColumnReady = () => true
export const getSession = async () => session
export const onAuthChange = () => {}
export const signIn = async () => {}
export const signUp = async () => ({ session })
export const signOut = async () => location.reload()
export const isMember = async () => true
// same window as the real fetch: 120 days back, undated, and anything open
export const fetchTasks = async () => { await wait(); const since = addDays(today(), -120); return copy(tasks.filter(x => !x.due_date || x.due_date >= since || (x.source === 'manual' && ['pending', 'in_progress'].includes(x.status)))) }
export async function createTask(t) { await wait(); const row = { id: id(), source: 'manual', created_at: now(), updated_at: now(), ...t }; tasks.push(row); return copy(row) }
export async function updateTask(rowId, patch) {
  await wait()
  const r = tasks.find(x => x.id === rowId)
  // mirrors the worklog_touch trigger
  if (patch.status === 'done' && r.status !== 'done') r.done_at = now()
  if (patch.status && patch.status !== 'done') r.done_at = null
  Object.assign(r, patch, { updated_at: now() })
  return copy(r)
}
export const historyStart = () => addDays(today(), -120)
export async function fetchRange(from, to) {
  await wait(300)
  return copy(tasks.filter(x => (x.due_date && x.due_date >= from && x.due_date <= to) || (x.done_at && x.done_at.slice(0, 10) >= addDays(from, -1) && x.done_at.slice(0, 10) <= addDays(to, 1))))
}
export async function deleteTask(rowId) { await wait(); tasks = tasks.filter(x => x.id !== rowId) }
export async function restoreTask(row) { await wait(); tasks.push(copy(row)); return copy(row) }
export const fetchNotes = async () => copy(notes)
export async function addNote(note_date, content) { const r = { id: id(), note_date, content, category: 'plan', created_at: now() }; notes.push(r); return copy(r) }
export async function deleteNote(noteId) { notes = notes.filter(x => x.id !== noteId) }
export const lastSyncRun = async () => copy(lastRun)
export async function triggerSync() { await wait(900); lastRun.started_at = lastRun.finished_at = now(); return { ok: true, found: tasks.length, added: 0, removed: 0 } }
const settings = { digest: { daily: true, weekend: true } }
export const getSetting = async key => copy(settings[key] || {})
export async function setSetting(key, value) { settings[key] = copy(value) }
export async function fetchView() { await wait(); return { tasks: copy(tasks), notes: copy(notes), lastRun: copy(lastRun) } }
