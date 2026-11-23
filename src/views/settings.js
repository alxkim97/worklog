import { state } from '../store.js'
import { DEPTS } from '../../lib/depts.js'
import { timeAgo } from '../dates.js'
import { esc, icon } from '../ui.js'
import { canNotify } from '../reminders.js'
import { remindColumnReady } from '../data.js'
import { lineSender } from '../line.js'

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

// Two columns on a wide window (stacked on narrow ones and the phone):
// plan + display settings on the left, reminders + app on the right.
export function renderSettings({ isPhone }) {
  const p = state.prefs
  const run = state.lastRun

  const search = isPhone ? `
    <section class="card">
      <button class="row-link" data-act="nav" data-view="search">${icon('search', 20)}<span>Search</span>${icon('right', 18)}</button>
      <button class="row-link" data-act="nav" data-view="summary">${icon('chart', 20)}<span>R&amp;D Summary</span>${icon('right', 18)}</button>
    </section>` : ''

  const plan = `
    <section class="card">
      <header class="card-head"><h2>${icon('sync', 18)} Production plan</h2></header>
      <p class="setting-line">${esc(syncSummary(run))}</p>
      ${run?.ok === false && run.error ? `<p class="error-text">${esc(run.error)}</p>` : ''}
      <button class="btn primary" data-act="sync" ${state.syncing ? 'disabled' : ''}>${icon('sync', 16)} ${state.syncing ? 'Syncing…' : 'Sync now'}</button>
      <p class="muted small">Syncs from the Google Sheet every morning and whenever you open WorkLog after an hour away.</p>
    </section>`

  const show = `
    <section class="card">
      <header class="card-head"><h2>${icon('layers', 18)} What to show</h2></header>
      <label class="setting-label">Production layer</label>
      ${seg('layer', p.production, [['all', 'Everything'], ['pv', 'PV + R&D line'], ['off', 'Just mine']])}
      <label class="setting-label">Departments</label>
      <div class="dept-toggles">
        ${DEPTS.map(d => `<button type="button" class="dept-toggle ${p.hiddenDepts.includes(d.key) ? '' : 'on'}" style="--c:${d.color}" data-act="dept" data-value="${d.key}" aria-pressed="${!p.hiddenDepts.includes(d.key)}"><i></i>${d.label}</button>`).join('')}
      </div>
    </section>`

  const reminders = `
    <section class="card">
      <header class="card-head"><h2>${icon('bell', 18)} Reminders</h2></header>
      <label class="setting-label">PV lots — remind me</label>
      ${seg('pv-remind', p.pvRemind == null ? 'off' : String(p.pvRemind), [['off', 'Off'], ['0', 'On the day'], ['1', '1 day before'], ['2', '2 days'], ['3', '3 days']])}
      <label class="setting-label">When the plan moves a PV or R&D-line step</label>
      ${seg('change-alerts', p.changeAlerts === false ? 'off' : 'on', [['on', 'Notify me'], ['off', 'Just list it on Today']])}
      <label class="setting-label" for="remind-time">At</label>
      <input type="time" id="remind-time" class="time-input" value="${esc(p.remindTime)}">
      <label class="setting-label">Sound</label>
      <div class="row-gap">
        ${seg('sound', p.sound === false ? 'off' : 'on', [['on', 'Soft chime'], ['off', 'Silent']])}
        <button class="btn ghost small" data-act="test-sound" title="Play the chime">${icon('play', 14)} Play</button>
      </div>
      <label class="setting-label">LINE (to your phone)</label>
      ${lineSender() ? `
        <div class="row-gap">
          ${seg('line', p.line === true ? 'on' : 'off', [['on', 'Send to LINE'], ['off', 'Off']])}
          <button class="btn ghost small" data-act="test-line">Send a test</button>
        </div>
        <p class="muted small" style="margin-top:8px">Reminders and plan changes also go to your LINE (Lotto777, only to you), sent by this desktop app while it runs.</p>`
        : `<p class="muted small" style="margin:0">Sent by the desktop app (switch it on there in Settings), so your phone gets reminders even when WorkLog is closed.</p>`}
      <div class="row-gap" style="margin-top:14px"><button class="btn soft small" data-act="test-notify">${icon('bell', 15)} Send a test</button></div>
      <p class="muted small">Applies to every PV step from the plan unless you set something else on the step. Any task can have its own reminder: open it and pick <b>Remind me</b>.
        ${window.electronAPI ? 'Reminders pop up as Windows notifications while WorkLog runs (it keeps running in the tray).' : canNotify() ? `This browser shows them only while WorkLog is open${typeof Notification !== 'undefined' && Notification.permission === 'denied' ? ' — and notifications are blocked for this site' : ''}. The desktop app is the reliable one.` : 'This browser can’t show notifications — use the desktop app.'}</p>
      ${remindColumnReady() ? '' : '<p class="error-text">Per-task reminders need one line of SQL in Supabase (SETUP.md, part D). PV reminders work already.</p>'}
    </section>`

  const widget = window.electronAPI?.widget ? `
    <section class="card">
      <header class="card-head"><h2>${icon('pin', 18)} Desktop widget</h2></header>
      <p class="setting-line">A small calendar that stays on your desktop.</p>
      <button class="btn soft" data-act="widget">${icon('pin', 16)} Pin to desktop</button>
      <p class="muted small">Drag it by its title bar, resize from the edges. The pin button on the widget keeps it above other windows.</p>
    </section>` : ''

  const appearance = `
    <section class="card">
      <header class="card-head"><h2>${icon('moon', 18)} Appearance</h2></header>
      ${seg('theme', p.theme, [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}
    </section>`

  const data = `
    <section class="card">
      <header class="card-head"><h2>${icon('download', 18)} Data</h2></header>
      <button class="btn soft" data-act="export">${icon('download', 16)} Export CSV</button>
    </section>`

  const account = `
    <section class="card">
      <header class="card-head"><h2>Account</h2></header>
      <p class="setting-line">${esc(state.session?.user?.email || '')}</p>
      <div class="row-gap">
        ${window.electronAPI ? `<button class="btn soft" data-act="update">Check for updates</button>` : ''}
        <button class="btn ghost" data-act="signout">${icon('logout', 16)} Sign out</button>
      </div>
      <p class="muted small version">WorkLog v${__APP_VERSION__} · Alex Kim</p>
    </section>`

  return `
    <div class="settings">
      <div class="settings-col">${search}${plan}${show}${appearance}${data}</div>
      <div class="settings-col">${reminders}${widget}${account}</div>
    </div>`
}
