// View mode: the "Open WorkLog (view)" link on Orbit's LINE cards opens
// /?view=1 — look, don't touch. It sticks for that browser tab (sessionStorage),
// so moving around the app stays read-only; "Open full app" leaves it.
const KEY = 'wl_view'

export const readOnly = (() => {
  try {
    const q = new URLSearchParams(location.search)
    if (q.has('view')) {
      sessionStorage.setItem(KEY, '1')
      q.delete('view'); q.delete('openExternalBrowser')
      history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash)
    }
    return sessionStorage.getItem(KEY) === '1'
  } catch { return false }
})()

if (readOnly) document.documentElement.classList.add('read-only')

export function leaveViewMode() {
  try { sessionStorage.removeItem(KEY) } catch {}
  location.replace(location.pathname)
}

// A task dialog in view mode: everything visible, nothing editable.
export function lockForm(el) {
  if (!readOnly) return
  el.querySelectorAll('input, textarea, select').forEach(i => { i.disabled = true })
  el.querySelectorAll('[type=submit], [data-delete], .cl-add, .cl-del, [data-span]').forEach(b => b.remove())
  el.querySelectorAll('.more-opts').forEach(d => { d.open = true })
}
