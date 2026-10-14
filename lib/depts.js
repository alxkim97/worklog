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

// Process steps (column B of the PLAN tab), in sheet order — also the order a
// lot moves through them.
export const STEPS = ['Mix', 'Tab', 'Capsule', 'Coat', 'Powder', 'Bottle', 'Strip', 'Blister', 'Fill Cream', 'Fill Liquid', 'Packing']


export function deptRank(key) {
  const i = DEPTS.findIndex(d => d.key === key)
  return i === -1 ? DEPTS.length : i
}
