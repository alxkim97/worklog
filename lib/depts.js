// Departments, shared by the app (colours, ordering) and the server-side
// sheet sync (normalising the sheet's section labels). Kept dependency-free
// so both Vite and the Vercel function can import it.

export const DEPTS = [
  { key: 'rd',      label: 'R&D',     color: '#7c5cff' },
  { key: 'disp',    label: 'Disp',    color: '#ff9f1a' },
  { key: 'tablets', label: 'Tablets', color: '#16b67c' },
  { key: 'cream',   label: 'Cream',   color: '#00b8d4' },
  { key: 'liquid',  label: 'Liquid',  color: '#2f7bff' },
  { key: 'packing', label: 'Packing', color: '#ff4f9a' },
  { key: 'other',   label: 'Other',   color: '#8a8fa3' },
]

export const DEPT_BY_KEY = Object.fromEntries(DEPTS.map(d => [d.key, d]))

// Manufacturing steps in the order a lot moves through them.
export const STEPS = ['Powder', 'Mix', 'Tab', 'Capsule', 'Coat', 'Bottle', 'Strip', 'Blister']

// Sheet section labels → dept key. Anything unrecognised is 'other' rather
// than dropped, so a new sheet section still shows up (in grey) instead of
// silently vanishing from the calendar.
export function deptKey(label) {
  const s = String(label || '').trim().toLowerCase().replace(/[^a-z&]/g, '')
  if (!s) return 'other'
  if (s === 'rd' || s === 'r&d') return 'rd'
  if (s.startsWith('disp')) return 'disp'
  if (s.startsWith('tab')) return 'tablets'
  if (s.startsWith('cream')) return 'cream'
  if (s.startsWith('liq')) return 'liquid'
  if (s.startsWith('pack')) return 'packing'
  return 'other'
}

export function deptRank(key) {
  const i = DEPTS.findIndex(d => d.key === key)
  return i === -1 ? DEPTS.length : i
}
