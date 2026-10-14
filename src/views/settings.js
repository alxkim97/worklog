import { state } from '../store.js'
import { DEPTS } from '../../lib/depts.js'
import { timeAgo } from '../dates.js'
import { esc, icon } from '../ui.js'

const seg = (act, current, options) => `
  <div class="seg" role="radiogroup">
    ${options.map(([v, label]) => `<button type="button" role="radio" aria-checked="${current === v}" class="${current === v ? 'on' : ''}" data-act="${act}" data-value="${v}">${label}</button>`).join('')}
  </div>`

export function syncSummary(run) {
  if (!run) return 'Not synced yet'
  if (run.ok === false) return `Last sync failed ${timeAgo(run.started_at)}`
  if (run.ok == null) return 'Syncing…'
  const bits = [`Synced ${timeAgo(run.finished_at || run.started_at)}`]
  if (run.added) bits.push(`${run.added} new`)
  if (run.removed) bits.push(`${run.removed} removed`)
  return bits.join(' · ')
}

export function renderSettings({ isPhone }) {
  const p = state.prefs
  const run = state.lastRun
  return `
    <div class="settings">
      ${isPhone ? `
        <section class="card">
          <button class="row-link" data-act="nav" data-view="lots">${icon('flask', 20)}<span>PV lots</span>${icon('right', 18)}</button>
          <button class="row-link" data-act="nav" data-view="search">${icon('search', 20)}<span>Search</span>${icon('right', 18)}</button>
        </section>` : ''}

      <section class="card">
        <header class="card-head"><h2>${icon('sync', 18)} Production plan</h2></header>
        <p class="setting-line">${esc(syncSummary(run))}</p>
        ${run?.ok === false && run.error ? `<p class="error-text">${esc(run.error)}</p>` : ''}
        <button class="btn primary" data-act="sync" ${state.syncing ? 'disabled' : ''}>${icon('sync', 16)} ${state.syncing ? 'Syncing…' : 'Sync now'}</button>
        <p class="muted small">Syncs from the Google Sheet every morning and whenever you open WorkLog after an hour away.</p>
      </section>

      <section class="card">
        <header class="card-head"><h2>${icon('layers', 18)} What to show</h2></header>
        <label class="setting-label">Production layer</label>
        ${seg('layer', p.production, [['all', 'Everything'], ['pv', 'PV + R&D line'], ['off', 'Just mine']])}
        <label class="setting-label">Departments</label>
        <div class="dept-toggles">
          ${DEPTS.map(d => `<button type="button" class="dept-toggle ${p.hiddenDepts.includes(d.key) ? '' : 'on'}" style="--c:${d.color}" data-act="dept" data-value="${d.key}" aria-pressed="${!p.hiddenDepts.includes(d.key)}"><i></i>${d.label}</button>`).join('')}
        </div>
      </section>

      <section class="card">
        <header class="card-head"><h2>${icon('moon', 18)} Appearance</h2></header>
        ${seg('theme', p.theme, [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}
      </section>

      <section class="card">
        <header class="card-head"><h2>${icon('download', 18)} Data</h2></header>
        <button class="btn soft" data-act="export">${icon('download', 16)} Export CSV</button>
      </section>

      <section class="card">
        <header class="card-head"><h2>Account</h2></header>
        <p class="setting-line">${esc(state.session?.user?.email || '')}</p>
        <div class="row-gap">
          ${window.electronAPI ? `<button class="btn soft" data-act="update">Check for updates</button>` : ''}
          <button class="btn ghost" data-act="signout">${icon('logout', 16)} Sign out</button>
        </div>
        <p class="muted small version">WorkLog v${__APP_VERSION__}</p>
      </section>
    </div>`
}
