'use strict';
// Must be FIRST — before any require that could throw
process.on('uncaughtException', (err) => {
  try {
    require('fs').appendFileSync(
      require('os').homedir() + '/Documents/WorkLog/crash.log',
      '[' + new Date().toISOString() + '] ' + err.stack + '\n'
    );
  } catch {}
});

// Fix: the npm electron package is cached at Electron startup, causing require('electron')
// to return a path string from cache before Electron's patched Module._load can intercept.
// Clear the npm package cache entries so the next require goes through the Electron interceptor.
(function clearElectronNpmCache() {
  try {
    const Module = require('module');
    const sep = require('path').sep;
    for (const key of Object.keys(Module._cache)) {
      if (key.includes(sep + 'node_modules' + sep + 'electron' + sep)) {
        delete Module._cache[key];
      }
    }
  } catch (e) {}
})();
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const http = require('http');
const { URL } = require('url');

const isDev    = process.argv.includes('--dev');
const DATA_DIR = path.join(os.homedir(), 'Documents', 'WorkLog');
const CFG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_CFG = {
  supabase: { url: '', anonKey: '' },
  google: {
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    accessToken: '',
    tokenExpiry: 0,
    spreadsheetId: '1GpGLBMrMC3OdVS8alpghKgTn_8PPG7hvT49XQJOrzNc'
  },
  sync: { intervalHours: 4, lastSync: null },
  theme: 'dark',
  view: 'month',
  colors: { rd: '#818cf8', disp: '#f59e0b', tablets: '#10b981', cream: '#06b6d4', liquid: '#3b82f6', packing: '#ec4899' }
};

let config = JSON.parse(JSON.stringify(DEFAULT_CFG));

function loadConfig() {
  try {
    if (fs.existsSync(CFG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CFG_FILE, 'utf-8'));
      config = deepMerge(DEFAULT_CFG, saved);
    }
  } catch { config = JSON.parse(JSON.stringify(DEFAULT_CFG)); }
}

function saveConfig() {
  try { fs.writeFileSync(CFG_FILE, JSON.stringify(config, null, 2)); } catch {}
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const k of Object.keys(override)) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k]))
      out[k] = deepMerge(base[k] || {}, override[k]);
    else
      out[k] = override[k];
  }
  return out;
}

// ── Supabase ──────────────────────────────────────────────────────────────────
let supabase = null;

function initSupabase() {
  if (!config.supabase.url || !config.supabase.anonKey) return false;
  try {
    const { createClient } = require('@supabase/supabase-js');
    const ws = require('ws');
    supabase = createClient(config.supabase.url, config.supabase.anonKey, {
      auth: { persistSession: false },
      realtime: { transport: ws }
    });
    return true;
  } catch (e) {
    console.error('Supabase init failed:', e.message);
    return false;
  }
}

// ── Google OAuth2 (Desktop App flow, loopback redirect) ──────────────────────
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

async function startOAuthFlow() {
  if (!config.google.clientId || !config.google.clientSecret)
    throw new Error('Google OAuth credentials not configured. Set Client ID and Client Secret in Settings first.');

  return new Promise((resolve, reject) => {
    let port;

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://localhost:${port}`);
        const code  = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        const ok   = `<html><body style="font-family:system-ui;padding:2rem;background:#0f172a;color:#e2e8f0"><h2 style="color:#6366f1">✓ WorkLog: Authorized!</h2><p>You can close this tab and return to WorkLog.</p></body></html>`;
        const fail = `<html><body style="font-family:system-ui;padding:2rem;background:#0f172a;color:#e2e8f0"><h2 style="color:#ef4444">✗ Authorization failed</h2><p>${error || 'Unknown error'}</p></body></html>`;

        if (!code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(fail);
          server.close();
          return reject(new Error(error || 'No auth code received'));
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(ok);
        server.close();

        // Exchange code → tokens
        const redirectUri = `http://localhost:${port}`;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id:     config.google.clientId,
            client_secret: config.google.clientSecret,
            redirect_uri:  redirectUri,
            grant_type:    'authorization_code'
          })
        });
        const tokens = await tokenRes.json();
        if (tokens.error) return reject(new Error(tokens.error_description || tokens.error));

        config.google.refreshToken = tokens.refresh_token || config.google.refreshToken;
        config.google.accessToken  = tokens.access_token;
        config.google.tokenExpiry  = Date.now() + (tokens.expires_in || 3600) * 1000;
        saveConfig();
        resolve({ success: true });

      } catch (e) { server.close(); reject(e); }
    });

    server.listen(0, 'localhost', () => {
      port = server.address().port;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id',     config.google.clientId);
      authUrl.searchParams.set('redirect_uri',  `http://localhost:${port}`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope',         SHEETS_SCOPE);
      authUrl.searchParams.set('access_type',   'offline');
      authUrl.searchParams.set('prompt',        'consent');
      shell.openExternal(authUrl.toString());
    });

    server.on('error', (e) => { reject(e); });
    setTimeout(() => { try { server.close(); } catch {} reject(new Error('OAuth timed out (5 min)')); }, 300_000);
  });
}

async function getAccessToken() {
  if (config.google.accessToken && Date.now() < config.google.tokenExpiry - 60_000)
    return config.google.accessToken;

  if (!config.google.refreshToken) throw new Error('Not connected to Google. Please connect in Settings.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: config.google.refreshToken,
      grant_type:    'refresh_token'
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);

  config.google.accessToken = data.access_token;
  config.google.tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  saveConfig();
  return data.access_token;
}

// ── Google Sheets Parser ───────────────────────────────────────────────────────
async function fetchSheetRows() {
  const token = await getAccessToken();
  const sid   = config.google.spreadsheetId;

  // Fetch sheet metadata to find the correct tab name
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!metaRes.ok) {
    const err = await metaRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets metadata ${metaRes.status}`);
  }
  const meta = await metaRes.json();
  const sheetTitles = (meta.sheets || []).map(s => s.properties.title);
  slog('Available sheets: ' + sheetTitles.join(', '));

  // Find "PLAN" tab (case-insensitive), fall back to first sheet
  const planTitle = sheetTitles.find(t => t.trim().toUpperCase() === 'PLAN') || sheetTitles[0];
  if (!planTitle) throw new Error('No sheets found in spreadsheet');

  const range = encodeURIComponent(`${planTitle}!A1:Z2000`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${range}?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets API ${res.status}`);
  }
  const data = await res.json();
  const rows = data.values || [];
  // Log first 10 rows for parser debugging
  rows.slice(0, 10).forEach((r, i) => slog(`row${i}: ` + JSON.stringify(r)));
  return rows;
}

function parseSheetTasks(rows) {
  const MONTH_MAP = {
    jan:1,feb:2,mar:3,apr:4,may:5,jun:6,
    jul:7,aug:8,sep:9,oct:10,nov:11,dec:12
  };
  const SKIP_CELLS = new Set(['B','RD','Semi','Clean','รวม','Total','']);

  const tasks = [];
  const seen  = new Set();
  let curMonth   = null;
  let curYear    = null;
  let dayColumns = []; // [{col, day}]
  let curSection = '';
  let curSub     = '';

  for (const row of rows) {
    if (!row || row.length === 0) continue;

    // Month header: "APR/2026", "MAY/2026"
    const rowText = row.join(' ');
    const mh = rowText.match(/\b([A-Za-z]{3,9})\/(\d{4})\b/);
    if (mh) {
      const m = MONTH_MAP[mh[1].slice(0, 3).toLowerCase()];
      if (m) { curMonth = m; curYear = parseInt(mh[2]); dayColumns = []; }
      continue;
    }

    if (!curMonth) continue;

    // Day header row: ≥3 cells that are integers 1–31, all unique
    // (batch/mix rows repeat the same number like "1,1,1,1" and must not match)
    const candidates = [];
    for (let c = 0; c < row.length; c++) {
      const v = (row[c] || '').trim();
      const n = parseInt(v);
      if (n >= 1 && n <= 31 && String(n) === v) candidates.push({ col: c, day: n });
    }
    const uniqueDays = new Set(candidates.map(c => c.day));
    if (candidates.length >= 3 && uniqueDays.size >= 3) { dayColumns = candidates; continue; }
    if (!dayColumns.length) continue;

    // Track section / subsection labels
    if ((row[0] || '').trim()) curSection = row[0].trim();
    if ((row[1] || '').trim()) curSub     = row[1].trim();

    const isDisp = curSub === 'Disp';

    for (const { col, day } of dayColumns) {
      // Disp row: product sits at dayCol itself; other rows: product at dayCol+1
      const cell = ((isDisp ? row[col] : row[col + 1]) || '').trim();
      if (!cell || SKIP_CELLS.has(cell) || /^\d+$/.test(cell)) continue;

      // Month rollover: small day numbers within a week that also has large days = next month
      const maxDay = Math.max(...dayColumns.map(d => d.day));
      let m = curMonth, y = curYear;
      if (day < 10 && maxDay > 20) {
        m = curMonth === 12 ? 1 : curMonth + 1;
        y = curMonth === 12 ? curYear + 1 : curYear;
      }

      const dateStr  = `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const sheetRef = `${dateStr}::${cell.slice(0, 40)}`;
      if (seen.has(sheetRef)) continue;
      seen.add(sheetRef);

      const lotMatch = cell.match(/\((\d{2,3})\)/);
      const section  = [curSection, isDisp ? 'Disp' : curSub].filter(Boolean).join(' › ');
      const isPv     = /\bPV\d*/i.test(cell);
      const dept     = isDisp ? 'Disp' : (curSection.trim() || null);

      tasks.push({
        title:        cell,
        type:         isPv ? 'pv_lot' : 'production',
        status:       'pending',
        priority:     'normal',
        due_date:     dateStr,
        product_name: cell,
        product_code: null,
        lot_number:   lotMatch ? lotMatch[1] : null,
        notes:        section || null,
        section:      dept,
        assignee:     null,
        source:       'sheet',
        sheet_ref:    sheetRef
      });
    }
  }
  return tasks;
}

// ── Sync ──────────────────────────────────────────────────────────────────────
async function syncSheets() {
  if (!config.google.refreshToken)
    return { success: false, reason: 'Google not connected' };
  if (!supabase)
    return { success: false, reason: 'Supabase not configured' };

  try {
    const rows  = await fetchSheetRows();
    const tasks = parseSheetTasks(rows);

    if (tasks.length === 0) {
      config.sync.lastSync = new Date().toISOString();
      saveConfig();
      return { success: true, imported: 0 };
    }

    const { error } = await supabase
      .from('work_tasks')
      .upsert(tasks, { onConflict: 'sheet_ref' });
    if (error) throw error;

    config.sync.lastSync = new Date().toISOString();
    saveConfig();
    return { success: true, imported: tasks.length };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// ── Auto-sync timer ───────────────────────────────────────────────────────────
let syncTimer = null;

function startSyncTimer() {
  if (syncTimer) clearInterval(syncTimer);
  const ms = (config.sync.intervalHours || 4) * 3_600_000;
  syncTimer = setInterval(async () => {
    const result = await syncSheets();
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('sync-complete', result);
  }, ms);
}

// ── Electron window ───────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 1024, minHeight: 680,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
  Menu.setApplicationMenu(null);
}

// ── App lifecycle + IPC (all inside whenReady to ensure Electron is ready) ────
const LOG_FILE = path.join(DATA_DIR, 'startup.log');
function slog(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

app.whenReady().then(async () => {
  try {
    slog('whenReady fired');
    loadConfig();
    slog('config loaded');
    initSupabase();
    slog('supabase init done');
    createWindow();
    slog('window created');
    startSyncTimer();
    slog('sync timer started');

  // ── IPC Handlers ────────────────────────────────────────────────────────────
  ipcMain.handle('get-config', () => ({
    theme:              config.theme,
    view:               config.view,
    colors:             config.colors,
    supabaseConfigured: !!(config.supabase.url && config.supabase.anonKey),
    googleConfigured:   !!config.google.refreshToken,
    lastSync:           config.sync.lastSync,
    spreadsheetId:      config.google.spreadsheetId,
    syncIntervalHours:  config.sync.intervalHours
  }));

  ipcMain.handle('save-supabase', (_, { url, anonKey }) => {
    config.supabase.url     = url.trim();
    config.supabase.anonKey = anonKey.trim();
    saveConfig();
    return initSupabase();
  });

  ipcMain.handle('save-google-creds', (_, { clientId, clientSecret, spreadsheetId }) => {
    config.google.clientId     = clientId.trim();
    config.google.clientSecret = clientSecret.trim();
    if (spreadsheetId) config.google.spreadsheetId = spreadsheetId.trim();
    saveConfig();
    return true;
  });

  ipcMain.handle('google-connect', async () => {
    try   { return await startOAuthFlow(); }
    catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('google-disconnect', () => {
    config.google.refreshToken = '';
    config.google.accessToken  = '';
    config.google.tokenExpiry  = 0;
    saveConfig();
    return true;
  });

  ipcMain.handle('sync-now', async () => syncSheets());

  ipcMain.handle('save-theme', (_, theme) => { config.theme = theme; saveConfig(); });
  ipcMain.handle('save-view',  (_, view)  => { config.view  = view;  saveConfig(); });
  ipcMain.handle('save-sync-interval', (_, hours) => {
    config.sync.intervalHours = hours;
    saveConfig();
    startSyncTimer();
  });

  ipcMain.handle('save-colors', (_, colors) => {
    config.colors = { ...config.colors, ...colors };
    saveConfig();
    return true;
  });

  // Tasks CRUD
  ipcMain.handle('tasks-get-all', async () => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('work_tasks').select('*').order('due_date', { ascending: true });
    if (error) throw error;
    return data || [];
  });

  ipcMain.handle('tasks-create', async (_, task) => {
    if (!supabase) throw new Error('Supabase not connected');
    const { data, error } = await supabase
      .from('work_tasks').insert(task).select().single();
    if (error) throw error;
    return data;
  });

  ipcMain.handle('tasks-update', async (_, { id, updates }) => {
    if (!supabase) throw new Error('Supabase not connected');
    const { data, error } = await supabase
      .from('work_tasks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (error) throw error;
    return data;
  });

  ipcMain.handle('tasks-delete', async (_, id) => {
    if (!supabase) throw new Error('Supabase not connected');
    const { error } = await supabase.from('work_tasks').delete().eq('id', id);
    if (error) throw error;
    return true;
  });

  ipcMain.handle('tasks-bulk-delete', async (_, ids) => {
    if (!supabase) throw new Error('Supabase not connected');
    const { error } = await supabase.from('work_tasks').delete().in('id', ids);
    if (error) throw error;
    return true;
  });

  // Initial sheet sync 10s after launch (silent background)
  setTimeout(async () => {
    if (config.google.refreshToken && supabase) {
      const result = await syncSheets();
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('sync-complete', result);
    }
  }, 10_000);

  slog('whenReady complete');
  } catch (e) {
    slog('FATAL: ' + e.stack);
  }
});

app.on('window-all-closed', () => {
  if (syncTimer) clearInterval(syncTimer);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

process.on('uncaughtException', (err) => {
  fs.appendFileSync(
    path.join(DATA_DIR, 'error.log'),
    `[${new Date().toISOString()}] ${err.stack}\n`
  );
});
