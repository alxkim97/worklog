# WorkLog

R&D planner for APm, layered on top of the production plan (Google Sheet).
Desktop (Electron), web, and phone (installable PWA) from one Vite codebase,
the same setup as Coin.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Browser dev server (also reachable from your phone on the same Wi-Fi) |
| `npm run demo` | Same, with fake in-memory data instead of Supabase — for design work |
| `npm test` | Unit tests (sheet parser, plan changes, messages, CLI) |
| `npm run build` | Build the web app into `dist/` |
| `npm run electron:dev` | Desktop app against the dev server |
| `npm run electron:build` | Build + package the Windows installer into `release/` |
| `npm run release` | Build installer and publish it as a GitHub Release (auto-update) |
| `npm run backup` | Save every row to `backups/` (needs `.env.local`, see the script) |
| `npm run shots -- file.json` | Screenshot the running app (see `scripts/shots.example.json`) |
| `npm run wl -- <command>` | Claude's CLI on the live data (`npm run wl -- help`); see below |

### Claude CLI (`scripts/worklog-claude.js`)

Read and edit the live data from a terminal, the same shape as Coin's
`coin-claude.js`. Needs `.env.local` (gitignored) with
`SUPABASE_SERVICE_ROLE_KEY` (Supabase secret key) and, for Orbit, `CRON_SECRET`
(same value as in Vercel).

- Read: `status`, `today [--date D]`, `week [--from D]`, `list --from D [--to D] [--q text]`,
  `pv [--all]`, `show <id>`, `overdue`, `search <text>`, `notes`, `changes [--save]`, `log`. Add `--json` for raw rows.
- Write: `add`, `edit`, `delete`, `set-status`, `note-add`, `note-delete`, `tick`, `remind`, `undo`.
  **Dry run unless `--apply`.** Applied changes are logged with their old values
  in `cli-log/changes.jsonl` (gitignored); `undo [n] --apply` reverses one.
- Plan rows from the sheet: only status, notes, remind_days and checklist can change; they can't be deleted.
- Orbit: `digest [--test] --apply`, `line '<text>' --apply` (through `api/digest` / `api/line-push`).
- Ids: the 8-character `#short` id printed in the output, or the full uuid.

**Bump `version` in package.json on every change** — it's shown in the app
(sidebar / Settings) so it's obvious which build is running.

## How it fits together

```
Google Sheet "PLAN" ──(api/sync-sheet, Vercel: daily cron + on app open)──► Supabase work_tasks
                                                                              ▲
                     WorkLog app (web / phone / desktop) ── reads & writes ───┘
```

- `lib/sheetParser.js` — turns the Gantt-style sheet into rows. Pure, tested.
- `lib/sheetSync.js` — Google service-account login + writes. It only ever
  writes sheet-owned columns, so your status/notes on sheet rows survive syncs;
  rows that vanish from the sheet get `sheet_removed_at` instead of lingering.
- `api/sync-sheet.js` — the Vercel function (cron or signed-in member).
- `src/` — the app. `main.js` (shell, routing, events), `views/` (Today, Week,
  Month, PV lots, Settings, Search), `editor.js` (task modal / bottom sheet),
  `store.js` (state + selectors), `data.js` (Supabase), `demoData.js`.
- Phone vs desktop is one breakpoint (860px) — same views, different CSS.
- `legacy/` — v1 (single-file Electron app) for reference; tag `v1.5.1-legacy`.

## Setup

See [supabase/SETUP.md](supabase/SETUP.md) — SQL to run, Vercel env vars, and
the Google service account.
