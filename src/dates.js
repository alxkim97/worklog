// Dates are plain 'YYYY-MM-DD' strings in local time everywhere (they compare
// correctly as strings). Never go through toISOString() — in Bangkok that's
// UTC and shifts the day before 7am.

const pad = n => String(n).padStart(2, '0')

export const toStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fromStr = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const today = () => toStr(new Date())

export function addDays(s, n) {
  const d = fromStr(s)
  d.setDate(d.getDate() + n)
  return toStr(d)
}

export function addMonths(s, n) {
  const d = fromStr(s)
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  return toStr(d)
}

export const daysBetween = (a, b) => Math.round((fromStr(b) - fromStr(a)) / 86400000)

// Weeks run Sunday → Saturday (Sunday leftmost in Week and Month).
export function weekStart(s) {
  const d = fromStr(s)
  d.setDate(d.getDate() - d.getDay())
  return toStr(d)
}

export const monthStart = s => s.slice(0, 8) + '01'
export const isWeekend = s => { const g = fromStr(s).getDay(); return g === 0 || g === 6 }
export const dayNum = s => Number(s.slice(8))

const fmt = opts => new Intl.DateTimeFormat('en-GB', opts)
const F = {
  wd: fmt({ weekday: 'short' }),
  wdLong: fmt({ weekday: 'long' }),
  dm: fmt({ day: 'numeric', month: 'short' }),
  dmy: fmt({ day: 'numeric', month: 'short', year: 'numeric' }),
  my: fmt({ month: 'long', year: 'numeric' }),
  long: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
}
export const weekday = s => F.wd.format(fromStr(s))
export const weekdayLong = s => F.wdLong.format(fromStr(s))
export const shortDate = s => (s.slice(0, 4) === today().slice(0, 4) ? F.dm : F.dmy).format(fromStr(s))
export const monthYear = s => F.my.format(fromStr(s))
export const longDate = s => F.long.format(fromStr(s))

// "Today", "Tomorrow", "Mon", or "12 Oct" — whichever reads fastest.
export function relDay(s) {
  const diff = daysBetween(today(), s)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return weekday(s)
  return shortDate(s)
}

export function timeAgo(iso) {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
