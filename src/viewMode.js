// View mode — look, don't touch. Two ways in:
//   /?v=<token>   the secret view link on Orbit's LINE cards: no sign-in, the
//                 plan comes from api/view (Settings → View link makes and
//                 replaces the token)
//   /?view=1      read-only while signed in (the fallback when no link exists)
// It sticks for that browser tab (sessionStorage), so moving around the app
// stays read-only; "Open full app" leaves it.
const KEY = 'wl_view'
const TOKEN_KEY = 'wl_view_token'

export const viewToken = (() => {
  try {
    const q = new URLSearchParams(location.search)
    const v = q.get('v')
    if (v && v.length >= 24) sessionStorage.setItem(TOKEN_KEY, v)
    if (q.has('view')) sessionStorage.setItem(KEY, '1')
    if (q.has('v') || q.has('view')) {
      q.delete('v'); q.delete('view'); q.delete('openExternalBrowser')
      history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash)
    }
    return sessionStorage.getItem(TOKEN_KEY) || null
  } catch { return null }
})()

export const readOnly = (() => {
  try { return !!viewToken || sessionStorage.getItem(KEY) === '1' } catch { return !!viewToken }
})()

if (readOnly) document.documentElement.classList.add('read-only')

export function leaveViewMode() {
  try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(TOKEN_KEY) } catch {}
  location.replace(location.pathname)
}

// A task dialog in view mode: everything visible, nothing editable.
export function lockForm(el) {
  if (!readOnly) return
  el.querySelectorAll('input, textarea, select').forEach(i => { i.disabled = true })
  el.querySelectorAll('[type=submit], [data-delete], .cl-add, .cl-del, [data-span]').forEach(b => b.remove())
  el.querySelectorAll('.more-opts').forEach(d => { d.open = true })
}

// A new secret token: 24 random bytes, URL-safe (32 characters).
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
