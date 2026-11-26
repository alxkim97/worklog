// Claude's command-line access to WorkLog's live data (same shape as Coin's
// scripts/coin-claude.js). Reads by default; every write shows what it would
// change and does nothing unless --apply is given. Applied changes are
// logged with their old values in cli-log/changes.jsonl (gitignored) and can
// be reversed with `undo`.
//
// Keys come from .env.local (gitignored, never printed):
//   SUPABASE_SERVICE_ROLE_KEY   Supabase → Project Settings → API keys
//   CRON_SECRET                 only for digest / line (same value as Vercel)
//   SUPABASE_URL                optional, defaults to WorkLog's project
//
// Usage: npm run wl -- <command> …   (or node scripts/worklog-claude.js …)
//   Read:  status · today [--date D] · week [--from D] · list --from D [--to D] [--q text]
//          pv [--all] · show <id> · overdue · search <text> · notes [--from D --to D]
//          changes [--save] · log
//   Write (add --apply to do it): add '<json>' · edit <id> '<json>' · delete <id>
//          set-status <id> <status> · note-add <date> '<text>' · note-delete <id>
//          tick <id> <item no.> [--untick] · remind <id> <off|default|days> · undo [<log no.>]
//   Orbit (add --apply to send): digest [--test] · line '<text>'
//   Any read takes --json.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminClient, WEB } from '../lib/server.js'
import { today, addDays, weekStart, weekday } from '../src/dates.js'
import { autoDone, isOpen, isSheet, pvLots, searchTasks } from '../lib/rd.js'
import { diffPlan, changeText } from '../lib/planDiff.js'
import { checklistFor } from '../src/checklists.js'
import {
  parseArgs, checkDate, parseJsonArg, checkPatch, checkNew, isOwnRow, parseRemind, remindText, tickPatch,
  changedFields, undoOf, matchId, shortId, fmtTask, fmtNote, fmtChanges, dayLines, lotLines, STATUSES,
} from '../lib/cli.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOG_DIR = join(ROOT, 'cli-log')
const LOG = join(LOG_DIR, 'changes.jsonl')
const SNAPSHOT = join(LOG_DIR, 'plan-snapshot.json')
const HISTORY_DAYS = 120

// ── Setup ──
function loadEnv() {
  const file = join(ROOT, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
loadEnv()
process.env.SUPABASE_URL ||= 'https://uhlbrxyvhfmfeakckzlu.supabase.co'
const API = (process.env.WORKLOG_API || WEB).replace(/\/$/, '')

class Usage extends Error {}
let supa
const db = () => {
  if (!supa) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Usage('SUPABASE_SERVICE_ROLE_KEY is not set — add it to .env.local (see the top of scripts/worklog-claude.js).')
    supa = adminClient()
  }
  return supa
}
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data }

// ── Reads ──
async function pages(build) {
  const out = []
  for (let start = 0; ; start += 1000) {
    const data = must(await build().range(start, start + 999))
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

// The app's own window: ~4 months back onward, plus your open tasks however old.
async function loadTasks() {
  const since = addDays(today(), -HISTORY_DAYS)
  const rows = await pages(() => db().from('work_tasks').select('*').is('sheet_removed_at', null)
    .or(`due_date.gte.${since},due_date.is.null,and(source.eq.manual,status.in.(pending,in_progress))`)
    .order('due_date', { ascending: true, nullsFirst: false }).order('id'))
  return rows.map(r => autoDone(r, today()))
}
async function loadRange(from, to) {
  const rows = await pages(() => db().from('work_tasks').select('*').is('sheet_removed_at', null)
    .gte('due_date', from).lte('due_date', to).order('due_date').order('id'))
  return rows.map(r => autoDone(r, today()))
}
const loadNotes = (from, to) => pages(() => db().from('work_date_notes').select('*').gte('note_date', from).lte('note_date', to).order('note_date').order('created_at'))

// A row by full id or the 8-character short id the output prints.
async function findTask(ref) {
  if (/^[0-9a-f-]{36}$/i.test(ref)) {
    const row = must(await db().from('work_tasks').select('*').eq('id', ref).maybeSingle())
    if (row) return row
  } else {
    const hit = matchId(await loadTasks(), ref)
    if (hit) return must(await db().from('work_tasks').select('*').eq('id', hit.id).single())
  }
  throw new Usage(`No task #${ref} (only rows from the last ${HISTORY_DAYS} days or still open can be found by short id)`)
}
async function findNote(ref) {
  const notes = await loadNotes(addDays(today(), -HISTORY_DAYS), addDays(today(), 400))
  const hit = /^[0-9a-f-]{36}$/i.test(ref) ? notes.find(n => n.id === ref) : matchId(notes, ref)
  if (!hit) throw new Usage(`No day note #${ref}`)
  return hit
}

// ── Change log ──
function readLog() {
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))
}
function writeLog(entry) {
  mkdirSync(LOG_DIR, { recursive: true })
  const n = (readLog().at(-1)?.n || 0) + 1
  appendFileSync(LOG, JSON.stringify({ n, at: new Date().toISOString(), ...entry }) + '\n')
  return n
}

// ── Output helpers ──
let JSON_OUT = false
const print = (text, data) => { console.log(JSON_OUT && data !== undefined ? JSON.stringify(data, null, 2) : text) }
const dayHead = d => `${d} ${weekday(d)}${d === today() ? ' (today)' : ''}`

// Every write goes through here: shows the change; applies + logs it only with --apply.
async function write({ flags, cmd, label, op, table, id, before, after, run, undoOf: undoNo }) {
  const changes = op === 'update' ? changedFields(before, after) : []
  if (op === 'update' && !changes.length) { console.log(`${label}: already like that — nothing to change.`); return }
  const detail = op === 'update' ? fmtChanges(changes) : ''
  if (!flags.apply) {
    console.log(`DRY RUN — ${label}${detail ? '\n' + detail : ''}\nNothing was changed. Re-run with --apply to do it.`)
    return
  }
  const result = await run()
  const rowId = id || result?.id
  const n = writeLog({ cmd, op, table, id: rowId, ...(undoNo ? { undo_of: undoNo } : {}), before: before || null, after: op === 'delete' ? null : (op === 'insert' ? result : after) })
  console.log(`DONE — ${label}${detail ? '\n' + detail : ''}\nLogged as #${n}. Undo: npm run wl -- undo ${n} --apply`)
}

const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row[k] ?? null]))

// ── Commands ──
const commands = {
  help() {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).filter((l, i, all) => all.slice(0, i + 1).every(x => x.startsWith('//'))).map(l => l.slice(3)).join('\n'))
  },

  async status() {
    const run = must(await db().from('worklog_sync_runs').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle())
    const tasks = await loadTasks()
    const own = tasks.filter(isOwnRow)
    const data = {
      supabase: process.env.SUPABASE_URL, api: API, orbit: process.env.CRON_SECRET ? 'ready' : 'CRON_SECRET not set',
      lastSync: run && { at: run.finished_at || run.started_at, ok: run.ok, trigger: run.trigger, found: run.found, added: run.added, removed: run.removed, error: run.error },
      rows: tasks.length, ownOpen: own.filter(isOpen).length, loggedChanges: readLog().length,
    }
    print([
      `Supabase: ${data.supabase}  (service role key: set)`,
      `Orbit:    ${data.orbit}  (${API})`,
      run ? `Last sheet sync: ${data.lastSync.at} · ${run.ok ? 'ok' : 'FAILED'} · ${run.trigger || '?'} · found ${run.found ?? '?'}, +${run.added ?? 0}, −${run.removed ?? 0}${run.error ? ` · ${run.error}` : ''}` : 'Last sheet sync: none recorded',
      `Rows loaded: ${data.rows} (your open tasks: ${data.ownOpen})`,
      `CLI change log: ${data.loggedChanges} entr${data.loggedChanges === 1 ? 'y' : 'ies'}`,
    ].join('\n'), data)
  },

  async today({ flags }) {
    const d = flags.date ? checkDate(flags.date, '--date') : today()
    const [tasks, notes] = await Promise.all([loadTasks(), loadNotes(d, d)])
    const lines = dayLines(tasks, notes, d)
    print([dayHead(d), ...(lines.length ? lines : ['  Nothing for R&D'])].join('\n'), { date: d, tasks: tasks.filter(t => t.due_date && (t.start_date || t.due_date) <= d && d <= t.due_date), notes })
  },

  async week({ flags }) {
    const from = flags.from ? checkDate(flags.from, '--from') : weekStart(today())
    const to = addDays(from, 6)
    const [tasks, notes] = await Promise.all([loadTasks(), loadNotes(from, to)])
    const out = []
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const lines = dayLines(tasks, notes, d)
      out.push(dayHead(d), ...(lines.length ? lines : ['  —']))
    }
    print(out.join('\n'), { from, to, tasks: tasks.filter(t => t.due_date && t.due_date >= from && (t.start_date || t.due_date) <= to), notes })
  },

  async list({ flags }) {
    if (!flags.from) throw new Usage('list needs --from YYYY-MM-DD (and optionally --to, default 6 days later)')
    const from = checkDate(flags.from, '--from')
    const to = flags.to ? checkDate(flags.to, '--to') : addDays(from, 6)
    let rows = await loadRange(from, to)
    if (flags.q) rows = searchTasks(rows, flags.q).reverse()
    print([...rows.map(t => fmtTask(t)), `${rows.length} row(s), ${from} → ${to}${flags.q ? ` matching "${flags.q}"` : ''}`].join('\n'), rows)
  },

  async pv({ flags }) {
    const lots = pvLots(await loadTasks(), today()).filter(l => flags.all || l.last >= today())
    print(lots.length ? lots.flatMap(lotLines).join('\n') : 'No active PV lots (try --all).', lots)
  },

  async show({ pos: [ref] }) {
    if (!ref) throw new Usage('show <id>')
    const t = autoDone(await findTask(ref), today())
    const items = checklistFor(t)
    const fields = ['id', 'title', 'type', 'status', 'priority', 'start_date', 'due_date', 'product_name', 'lot_number', 'step', 'section', 'assignee', 'notes', 'remind_days', 'source', 'sheet_path', 'updated_at']
    print([
      fmtTask(t),
      ...fields.filter(k => t[k] != null && t[k] !== '').map(k => `  ${k}: ${k === 'remind_days' ? `${t[k]} (${remindText(t[k])})` : t[k]}`),
      isSheet(t) ? '  (plan row from the sheet: only status, notes, remind_days, checklist can change)' : null,
      ...(items ? ['  Checklist' + (Array.isArray(t.checklist) && t.checklist.length ? '' : ' (default, not started)'), ...items.map((i, k) => `    ${k + 1}. [${i.done ? 'x' : ' '}] ${i.t}`)] : []),
    ].filter(Boolean).join('\n'), { ...t, checklist_items: items })
  },

  async overdue() {
    const rows = (await loadTasks()).filter(t => !(isSheet(t) && t.type !== 'pv_lot') && isOpen(t) && t.due_date && t.due_date < today())
    print(rows.length ? [...rows.map(t => fmtTask(t)), `${rows.length} overdue`].join('\n') : 'Nothing overdue.', rows)
  },

  async search({ pos }) {
    const q = pos.join(' ')
    if (!q.trim()) throw new Usage('search <text>')
    const rows = searchTasks(await loadTasks(), q)
    print([...rows.map(t => fmtTask(t)), `${rows.length} match(es) for "${q}" (last ${HISTORY_DAYS} days onward)`].join('\n'), rows)
  },

  async notes({ flags }) {
    const from = flags.from ? checkDate(flags.from, '--from') : addDays(today(), -7)
    const to = flags.to ? checkDate(flags.to, '--to') : addDays(today(), 14)
    const notes = await loadNotes(from, to)
    print([...notes.map(fmtNote), `${notes.length} note(s), ${from} → ${to}`].join('\n'), notes)
  },

  // Plan moves since the CLI's own saved copy (the app keeps its copy in the browser).
  async changes({ flags }) {
    const tasks = await loadTasks()
    const keep = tasks.filter(isSheet).map(t => pick(t, ['id', 'source', 'type', 'product_name', 'title', 'lot_number', 'step', 'section', 'due_date', 'sheet_path']))
    if (!existsSync(SNAPSHOT)) {
      mkdirSync(LOG_DIR, { recursive: true })
      writeFileSync(SNAPSHOT, JSON.stringify({ at: new Date().toISOString(), tasks: keep }))
      console.log('No saved plan yet — saved the current one. Run `changes` again later to see what moved.')
      return
    }
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
    const list = diffPlan(snap.tasks, keep, today())
    if (flags.save) writeFileSync(SNAPSHOT, JSON.stringify({ at: new Date().toISOString(), tasks: keep }))
    const lines = list.map(c => { const { what, how } = changeText(c); return `  ${what}: ${how}` })
    print([`Plan changes since ${snap.at} (PV steps + R&D line, upcoming only):`, ...(lines.length ? lines : ['  none']),
      flags.save ? 'Saved the current plan as the new baseline.' : 'Add --save to mark these as seen.'].join('\n'), { since: snap.at, changes: list })
  },

  log() {
    const log = readLog()
    const undone = new Set(log.filter(e => e.undo_of).map(e => e.undo_of))
    const lines = log.slice(-25).map(e => `#${e.n} ${e.at.slice(0, 16).replace('T', ' ')}  ${e.cmd}  ${e.op} ${e.table} #${shortId(e.id)}${e.undo_of ? `  (undo of #${e.undo_of})` : ''}${undone.has(e.n) ? '  [undone]' : ''}`)
    print(lines.length ? lines.join('\n') : 'No changes made from the CLI yet.', log)
  },

  // ── Writes ──
  async add({ pos: [json], flags }) {
    const row = checkNew(parseJsonArg(json))
    await write({ flags, cmd: 'add', label: `add task: ${fmtTask({ ...row, source: 'manual', id: 'new' })}`, op: 'insert', table: 'work_tasks',
      run: async () => must(await db().from('work_tasks').insert({ ...row, source: 'manual' }).select('*').single()) })
  },

  async edit({ pos: [ref, json], flags }) {
    if (!ref) throw new Usage("edit <id> '<json>'")
    const row = await findTask(ref)
    const patch = checkPatch(row, parseJsonArg(json))
    await update(flags, 'edit', row, patch)
  },

  async 'set-status'({ pos: [ref, status], flags }) {
    if (!ref || !STATUSES.includes(status)) throw new Usage(`set-status <id> <${STATUSES.join('|')}>`)
    const row = await findTask(ref)
    await update(flags, 'set-status', row, checkPatch(row, { status }))
  },

  async remind({ pos: [ref, when], flags }) {
    if (!ref || when == null) throw new Usage('remind <id> <off|default|days before>')
    const row = await findTask(ref)
    await update(flags, 'remind', row, checkPatch(row, { remind_days: parseRemind(when) }))
  },

  async tick({ pos: [ref, n], flags }) {
    if (!ref || !n) throw new Usage('tick <id> <item no.> [--untick]   (see the numbers with: show <id>)')
    const row = await findTask(ref)
    const patch = tickPatch(row, n, !flags.untick)
    const item = patch.checklist[Number(n) - 1]
    await update(flags, `${flags.untick ? 'untick' : 'tick'} "${item.t}"`, row, patch)
  },

  async delete({ pos: [ref], flags }) {
    if (!ref) throw new Usage('delete <id>')
    const row = await findTask(ref)
    if (!isOwnRow(row)) throw new Usage('That is a plan row from the Google Sheet — it can\'t be deleted here (change it in the sheet).')
    await write({ flags, cmd: 'delete', label: `delete task: ${fmtTask(row)}`, op: 'delete', table: 'work_tasks', id: row.id, before: row,
      run: async () => must(await db().from('work_tasks').delete().eq('id', row.id)) })
  },

  async 'note-add'({ pos: [date, ...text], flags }) {
    const content = text.join(' ').trim()
    if (!content) throw new Usage("note-add <YYYY-MM-DD> '<text>'")
    checkDate(date)
    await write({ flags, cmd: 'note-add', label: `add day note: ${date}  ${content}`, op: 'insert', table: 'work_date_notes',
      run: async () => must(await db().from('work_date_notes').insert({ note_date: date, content }).select('*').single()) })
  },

  async 'note-delete'({ pos: [ref], flags }) {
    if (!ref) throw new Usage('note-delete <id>')
    const note = await findNote(ref)
    await write({ flags, cmd: 'note-delete', label: `delete day note: ${fmtNote(note)}`, op: 'delete', table: 'work_date_notes', id: note.id, before: note,
      run: async () => must(await db().from('work_date_notes').delete().eq('id', note.id)) })
  },

  async undo({ pos: [num], flags }) {
    const log = readLog()
    const undone = new Set(log.filter(e => e.undo_of).map(e => e.undo_of))
    const entry = num ? log.find(e => e.n === Number(num)) : [...log].reverse().find(e => !e.undo_of && !undone.has(e.n))
    if (!entry) throw new Usage(num ? `No log entry #${num}` : 'Nothing to undo.')
    if (entry.undo_of) throw new Usage(`#${entry.n} is itself an undo — undo #${entry.undo_of}'s change again with a normal command instead.`)
    if (undone.has(entry.n)) throw new Usage(`#${entry.n} was already undone.`)
    const u = undoOf(entry)
    const t = db().from(u.table)
    if (u.op === 'update') {
      const current = must(await db().from(u.table).select('*').eq('id', u.id).maybeSingle())
      if (!current) throw new Usage(`The row from #${entry.n} no longer exists.`)
      await write({ flags, cmd: `undo #${entry.n}`, undoOf: entry.n, label: `undo #${entry.n} (${entry.cmd}) on ${fmtTask(current)}`, op: 'update', table: u.table, id: u.id,
        before: pick(current, Object.keys(u.patch)), after: u.patch,
        run: async () => must(await t.update(u.patch).eq('id', u.id).select('id').single()) })
    } else if (u.op === 'delete') {
      await write({ flags, cmd: `undo #${entry.n}`, undoOf: entry.n, label: `undo #${entry.n} (${entry.cmd}): delete the row it added #${shortId(u.id)}`, op: 'delete', table: u.table, id: u.id, before: entry.after,
        run: async () => must(await t.delete().eq('id', u.id)) })
    } else {
      await write({ flags, cmd: `undo #${entry.n}`, undoOf: entry.n, label: `undo #${entry.n} (${entry.cmd}): put back the deleted row #${shortId(u.id)}`, op: 'insert', table: u.table,
        run: async () => must(await t.insert(u.row).select('*').single()) })
    }
  },

  // ── Orbit (LINE) — through the live api/digest and api/line-push ──
  async digest({ flags }) {
    const mode = flags.test ? 'test' : 'auto'
    if (!flags.apply) {
      console.log(`DRY RUN — would ask ${API}/api/digest to send ${mode === 'test' ? 'a test digest card (always sends)' : "today's digest (skipped if it already went out today)"} to LINE.\nRe-run with --apply to send.`)
      return
    }
    console.log(JSON.stringify(await orbit('/api/digest', { mode })))
  },

  async line({ pos, flags }) {
    const text = pos.join(' ').trim()
    if (!text) throw new Usage("line '<text>'")
    if (!flags.apply) { console.log(`DRY RUN — would send to LINE (Orbit):\n  ${text}\nRe-run with --apply to send.`); return }
    console.log(JSON.stringify(await orbit('/api/line-push', { text })))
  },
}

async function update(flags, cmd, row, patch) {
  await write({ flags, cmd, label: `${cmd}: ${fmtTask(row)}`, op: 'update', table: 'work_tasks', id: row.id,
    before: pick(row, Object.keys(patch)), after: patch,
    run: async () => must(await db().from('work_tasks').update(patch).eq('id', row.id).select('id').single()) })
}

async function orbit(path, body) {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) throw new Usage('CRON_SECRET is not set — add the same value Vercel has to .env.local.')
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path}: ${out.error || res.status}`)
  return out
}

// ── Main ──
let args
try { args = parseArgs(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exit(2) }
JSON_OUT = !!args.flags.json
const fn = commands[args.cmd]
if (!fn || args.flags.help) { commands.help(); process.exit(fn ? 0 : 2) }
Promise.resolve(fn(args)).catch(e => {
  console.error(e instanceof Usage ? e.message : `Error: ${e.message || e}`)
  process.exit(e instanceof Usage ? 2 : 1)
})
