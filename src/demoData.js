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
    { name: 'Machto Gel PET 240mL PV1', lot: '114', dept: 'tablets', start: 2, steps: ['Mix', 'Tab', 'Blister'] },
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
    })
  }
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
export const fetchTasks = async () => { await wait(); return copy(tasks) }
export async function createTask(t) { await wait(); const row = { id: id(), source: 'manual', created_at: now(), updated_at: now(), ...t }; tasks.push(row); return copy(row) }
export async function updateTask(rowId, patch) { await wait(); const r = tasks.find(x => x.id === rowId); Object.assign(r, patch, { updated_at: now() }); return copy(r) }
export async function deleteTask(rowId) { await wait(); tasks = tasks.filter(x => x.id !== rowId) }
export async function restoreTask(row) { await wait(); tasks.push(copy(row)); return copy(row) }
export const fetchNotes = async () => copy(notes)
export async function addNote(note_date, content) { const r = { id: id(), note_date, content, category: 'plan', created_at: now() }; notes.push(r); return copy(r) }
export async function deleteNote(noteId) { notes = notes.filter(x => x.id !== noteId) }
export const lastSyncRun = async () => copy(lastRun)
export async function triggerSync() { await wait(900); lastRun.started_at = lastRun.finished_at = now(); return { ok: true, found: tasks.length, added: 0, removed: 0 } }
