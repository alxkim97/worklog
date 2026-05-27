# WorkLog — Session Handoff

**Last updated:** 2026-05-27
**Current version:** v1.3.0
**Branch:** main

---

## App overview

WorkLog is an Electron 31 desktop app for the R&D/PD team at APm. It reads the production schedule from a **Google Sheet (read-only, one-way sync)** and displays it as a calendar. R&D staff can layer their own tasks on top (PV lots, experiments, meetings, documents).

**Key files:**
- `index.html` — full UI, CSS, and JS in one file (~1700+ lines)
- `main.js` — Electron main process: IPC handlers, Google Sheets parser, Supabase client, sync scheduler
- `preload.js` — context bridge (`window.wl`)
- `supabase-setup.sql` — initial DB schema SQL
- `package.json` — Electron 31, @supabase/supabase-js ^2.45.0, ws ^8.21.0

**Run:** `npm start` (must use npm, not electron.exe directly — breaks `require`)
**Config dir (Windows):** `~/Documents/WorkLog/` → `config.json` (contains Supabase URL/key + Google OAuth tokens — never commit)
**Startup log:** `~/Documents/WorkLog/startup.log`

---

## Architecture

- **Supabase** (`work_tasks` table) — cloud backend, all tasks stored here
- **Google OAuth2 Desktop App** loopback redirect flow — stored refresh token in config.json
- **Google Sheets API v4** — reads the production plan spreadsheet, parses Gantt-chart format
- **Sheet parser** (in main.js `parseSheet()`): detects month header rows, day-column header rows (≥3 unique integers 1-31), then data rows keyed to day columns. Disp products at dayCol, other depts at dayCol+1. Month rollover detected via `maxDay > 20 && day < 10`.
- **Upsert deduplication** via `sheet_ref` unique column (format: `TABNAME|ROW|COL`)

---

## Database schema

```sql
work_tasks (
  id uuid PK, title text, type text, status text, priority text,
  start_date date, due_date date, lot_number text, product_code text,
  product_name text, section text, assignee text, notes text,
  source text ('manual'|'sheet'), sheet_ref text UNIQUE,
  created_at timestamptz, updated_at timestamptz
)
```

**Migration needed** (if table predates v1.1): run SQL in Settings → DB Schema tab.

---

## Feature overview (v1.3.0)

- **Month/week calendar views** — day chips color-coded by department
- **Multi-day task spanning** — tasks with start_date show across the full range
- **Department colors** — R&D (indigo), Disp (amber), Tablets (green), Cream (cyan), Liquid (blue), Packing (pink) — all user-customizable in Settings → General
- **Sidebar filters** — by Type, Status, Department, Source (Manual/Sheet); dept filter applies to both sheet and manual tasks
- **Day Detail modal** — click any day → all tasks grouped and sorted by dept order (R&D → Disp → Tablets → Cream → Liquid → Packing)
- **Task modal** — sheet tasks open read-only (notes editable only); manual tasks have full CRUD with dept selector defaulting to R&D
- **Export CSV** — exports currently filtered tasks to UTF-8 CSV (Excel-ready)
- **NEW badge** — red notification count on Sync button shows tasks added since last sync; click to dismiss
- **Notes indicator** — 📋 icon on chips when task has notes
- **Google Sheets sync** — manual + auto (configurable interval); Settings → Google Sheets tab
- **🎯 branding**, dark/light theme, toggleable sidebar, keyboard shortcuts

---

## What was done this session (2026-05-27)

### v1.2.0 — Visual & UX features
- 🎯 logo + title tag
- Packing color → pink `#ec4899`
- `color-mix()` for dynamic dept chip backgrounds (updates live when color changes)
- **Sidebar toggle** — hamburger `☰` button, CSS transition `width:0` when collapsed
- **Filter fix** — sheet `pv_lot` tasks now respect the PV Lot checkbox
- **Custom dept colors** — color pickers in Settings → General, persist via `save-colors` IPC
- **NEW tag** on chips + **notification badge** on Sync button — tracks tasks added since last sync
- Added `saveColors` to preload.js + DEFAULT_CFG + `get-config` + `save-colors` IPC in main.js

### v1.3.0 — Dept system + multi-day + export
- **R&D department** — indigo color, default for all manual tasks, top of sidebar filter, customizable color
- **Department selector** in task creation form (R&D default)
- **chipClass()** refactor — manual tasks default to `dept-rd`; both sheet and manual tasks use `deptClass(section)` consistently
- **Sheet tasks read-only** — `sheet-mode` CSS class on modal; type/priority/status/dept hidden; only Notes editable; Save → "Save Notes" (updates `notes` field only in Supabase)
- **Multi-day spanning** — `buildTasksByDate()` iterates start→due range; chips show dashed right border when task continues; local-date safe (no UTC offset bug)
- **Dept ordering** — `deptRank()` sorts tasks within each day: R&D → Disp → Tablets → Cream → Liquid → Packing
- **Export CSV** — `↓ CSV` topbar button, UTF-8 BOM, exports filtered tasks
- **Notes indicator** — 📋 on chips when `t.notes` is set
- **worklog2/worklog3** cleanup — added to `.gitignore`; empty `worklog/` subfolder removed

### Git setup
- GitHub repo: `https://github.com/iiAlera/worklog` (private)
- Push via PAT token (account flagged — OAuth blocked). Store PAT in Windows Credential Manager:
  `cmdkey /add:LegacyGeneric:target=git:https://github.com /user:iiAlera /pass:TOKEN`
- GitHub Desktop works once repo is added via **File → Add Local Repository**

---

## What to continue next session

1. **Test multi-day spanning** — create task with start/due range, verify it appears on all days
2. **Test sheet task read-only** — click a sheet chip, verify only Notes is editable
3. **Test R&D dept filter** — create manual task, verify it shows under R&D and filters correctly
4. **Feature ideas (priority order):**
   - Status auto-update: mark tasks as "Done" from the calendar without opening modal
   - Overdue highlighting: distinct style for past-due sheet tasks
   - Print/PDF view of weekly schedule
   - Task search bar
   - Notes export (include notes column in CSV — already done, verify it works)

---

## Session protocol

When you type **"git push"** to Claude Code:
1. Claude updates `HANDOFF.md` with session summary
2. Bumps version in `package.json`
3. Commits all changes + HANDOFF.md + package.json
4. Pushes to GitHub

## How to continue on another PC

**Step 1 — Pull latest via GitHub Desktop** (Fetch origin → Pull)  
**Step 2 — Run `npm install`** in the worklog folder  
**Step 3 — Paste this into a new Claude Code session:**

```
Continue WorkLog development. Read HANDOFF.md for full context. Current version: v1.3.0.

Key facts:
- Electron 31, vanilla HTML/CSS/JS, single-file renderer (index.html ~1700 lines)
- Supabase backend: work_tasks table (see HANDOFF.md for schema)
- Google Sheets API v4, OAuth2 Desktop App flow, one-way sync only (sheet → app)
- Config: ~/Documents/WorkLog/config.json (Supabase URL/key + Google tokens — never commit)
- Run: npm start | Git push: needs PAT token (account OAuth flagged — see HANDOFF.md)
- GitHub: https://github.com/iiAlera/worklog (private)

Last done: R&D dept default, multi-day task spanning, sheet tasks read-only (notes only), dept ordering in calendar, export CSV, notes indicator, NEW badge on sync, custom dept colors, sidebar toggle.
Pending: quick status toggle from calendar, overdue highlighting, print view, task search.
```
