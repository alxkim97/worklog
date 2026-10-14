import { toast } from './ui.js'
import { deptLabel, TYPE_BY_KEY } from './components.js'

const COLS = [
  ['Date', t => t.due_date], ['Start', t => t.start_date], ['Title', t => t.title],
  ['Type', t => t.source === 'sheet' && t.type === 'production' ? 'Production' : TYPE_BY_KEY[t.type]?.label || t.type],
  ['Department', t => deptLabel(t.section)], ['Step', t => t.step], ['Status', t => t.status],
  ['Priority', t => t.priority], ['Lot', t => t.lot_number], ['Notes', t => t.notes],
  ['Source', t => t.source], ['Sheet row', t => t.sheet_path],
]
const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

// UTF-8 BOM so Excel opens Thai product names correctly.
export function exportCsv(tasks) {
  const rows = [...tasks].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
  const csv = '\ufeff' + [COLS.map(c => c[0]), ...rows.map(t => COLS.map(c => c[1](t)))].map(r => r.map(cell).join(',')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `worklog-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  toast(`Exported ${rows.length} rows`)
}
