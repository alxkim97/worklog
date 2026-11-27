import { signIn, signOut } from '../data.js'
import { esc } from '../ui.js'

const shell = inner => `
  <div class="auth">
    <div class="auth-card">
      <div class="brand big"><img class="logo" src="./favicon.svg" alt=""><span>WorkLog</span></div>
      ${inner}
    </div>
  </div>`

// Sign in only. WorkLog is members-only: new accounts are made in Supabase
// (Authentication → Users → Add user), not here (SETUP.md part C).
export function renderAuth(root) {
  const draw = (msg = '') => {
    root.innerHTML = shell(`
      <p class="auth-sub">Your R&amp;D plan, on top of the production schedule.</p>
      <form class="auth-form">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
        ${msg ? `<p class="auth-msg">${esc(msg)}</p>` : ''}
        <button class="btn primary block" type="submit">Sign in</button>
      </form>`)
    root.querySelector('form').onsubmit = async e => {
      e.preventDefault()
      const f = new FormData(e.target)
      const btn = e.target.querySelector('button[type=submit]')
      btn.disabled = true
      try {
        await signIn(f.get('email'), f.get('password'))
      } catch (err) { draw(err.message || 'Something went wrong'); }
    }
  }
  draw()
}

// Signed in, but not on worklog_members yet — show the exact SQL to run.
export function renderNotMember(root, user, onRetry) {
  const sql = `insert into worklog_members (user_id, role)\nvalues ('${user.id}', 'owner')\non conflict (user_id) do nothing;`
  root.innerHTML = shell(`
    <h2>Almost there</h2>
    <p class="auth-sub">You're signed in as <b>${esc(user.email)}</b>, but this account isn't a WorkLog member yet.
      Run this once in the Supabase SQL editor:</p>
    <pre class="sql">${esc(sql)}</pre>
    <div class="row-gap">
      <button class="btn soft" data-copy>Copy SQL</button>
      <button class="btn primary" data-retry>I ran it</button>
    </div>
    <button class="link" data-out>Sign out</button>`)
  root.querySelector('[data-copy]').onclick = e => navigator.clipboard.writeText(sql).then(() => { e.target.textContent = 'Copied ✓' })
  root.querySelector('[data-retry]').onclick = onRetry
  root.querySelector('[data-out]').onclick = () => signOut()
}

export function renderNotConfigured(root) {
  root.innerHTML = shell(`
    <h2>Not connected yet</h2>
    <p class="auth-sub">Add the Supabase project URL and anon key to <code>src/config.js</code>, then rebuild.</p>`)
}
