import { state, searchTasks, isSheet } from '../store.js'
import { taskRow, prodChip, empty } from '../components.js'
import { esc, icon } from '../ui.js'

export function renderSearch({ isPhone }) {
  const results = searchTasks(state.search)
  const mine = results.filter(t => !isSheet(t) || t.type === 'pv_lot')
  const prod = results.filter(t => isSheet(t) && t.type !== 'pv_lot')
  return `
    <div class="search-view">
      ${isPhone ? `
        <label class="search-box big">${icon('search', 18)}
          <input type="search" id="search-input" placeholder="Search tasks, products, lots…" value="${esc(state.search)}" autocomplete="off">
        </label>` : ''}
      ${!state.search.trim() ? empty('Type to search everything: your tasks, products, lot numbers, notes.', '🔎')
        : !results.length ? empty(`No matches for “${state.search}”.`, '🤷')
        : `
          ${mine.length ? `<section class="card"><header class="card-head"><h2>Tasks</h2><span class="muted">${mine.length}</span></header><div class="list">${mine.map(t => taskRow(t)).join('')}</div></section>` : ''}
          ${prod.length ? `<section class="card"><header class="card-head"><h2>Production</h2><span class="muted">${prod.length}</span></header><div class="chips">${prod.map(t => prodChip(t, { date: true })).join('')}</div></section>` : ''}`}
    </div>`
}
