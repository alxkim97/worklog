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
| `npm test` | Sheet-parser tests |
| `npm run build` | Build the web app into `dist/` |
| `npm run electron:dev` | Desktop app against the dev server |
| `npm run electron:build` | Build + package the Windows installer into `release/` |
| `npm run release` | Build installer and publish it as a GitHub Release (auto-update) |
| `npm run backup` | Save every row to `backups/` (needs `.env.local`, see the script) |
| `npm run shots -- file.json` | Screenshot the running app (see `scripts/shots.example.json`) |

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
