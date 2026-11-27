const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, globalShortcut, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')

// Without this, Windows can cache the taskbar/Start icon against the shared
// dev electron.exe binary instead of this app's own icon. Unpackaged runs
// (npm run electron / electron:dev) get their own ID: sharing the installed
// app's ID made Windows draw the taskbar button from the installed app's
// Start-menu shortcut, so a dev build showed whatever icon that older
// install had baked in rather than assets/icon.ico.
app.setAppUserModelId(app.isPackaged ? 'com.apm.worklog' : 'com.apm.worklog.dev')

// Prevent duplicate windows from "Start with Windows" plus a manual launch.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

const isDev = process.argv.includes('--dev')
const startHidden = process.argv.includes('--hidden')
let mainWindow = null
let tray = null
let isQuitting = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 600,
    title: 'WorkLog',
    backgroundColor: '#0f0e17',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // the reminder chime plays from a window that sits hidden in the tray
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }

  // Show once painted to avoid a white flash on launch.
  // Started by Windows at login (--hidden): sit in the tray, no window popping up.
  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show() })
  mainWindow.on('closed', () => { mainWindow = null })

  // The X button minimizes to tray instead of quitting, so WorkLog keeps
  // running in the background — same as Pinboard — and stays reachable for
  // periodic update checks without needing to be reopened by hand.
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow.hide()
  })
}

// ── Month widget ──────────────────────────────────────────────────────────
// A small frameless window with the month calendar that lives on the desktop.
// Same bundle as the main window, loaded with #widget. Its position, size,
// pin-on-top and whether it was open are kept in userData/widget.json so it
// comes back where you left it after a restart.
let widgetWindow = null
const widgetFile = () => path.join(app.getPath('userData'), 'widget.json')
function loadWidgetState() {
  try { return JSON.parse(fs.readFileSync(widgetFile(), 'utf8')) } catch { return {} }
}
function saveWidgetState(patch) {
  const next = { ...loadWidgetState(), ...patch }
  try { fs.writeFileSync(widgetFile(), JSON.stringify(next)) } catch (err) { console.error('widget state:', err) }
  return next
}

// Saved bounds only if they still land on a connected screen.
function widgetBounds(saved) {
  const area = screen.getPrimaryDisplay().workArea
  const def = { width: 420, height: 560, x: area.x + area.width - 440, y: area.y + 20 }
  if (!saved?.bounds) return def
  const b = saved.bounds
  const onScreen = screen.getAllDisplays().some(d => {
    const w = d.workArea
    return b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y >= w.y - 10 && b.y < w.y + w.height - 40
  })
  return onScreen ? b : def
}

// Tell the main window when the widget opens or closes, so its pin button
// shows the real state (the widget can also close itself with its own button).
const widgetChanged = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('widget:changed', !!widgetWindow) }

function createWidget() {
  if (widgetWindow) { widgetWindow.show(); widgetWindow.focus(); return }
  const saved = loadWidgetState()
  widgetWindow = new BrowserWindow({
    ...widgetBounds(saved),
    // small enough to sit like a taskbar hover thumbnail (pills become dots)
    minWidth: 220,
    minHeight: 150,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: !!saved.onTop,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'WorkLog calendar',
    backgroundColor: '#0f0e17',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  if (isDev) widgetWindow.loadURL('http://localhost:5173/#widget')
  else widgetWindow.loadFile(path.join(__dirname, 'dist', 'index.html'), { hash: 'widget' })
  widgetWindow.once('ready-to-show', () => widgetWindow.showInactive())
  const remember = () => { if (widgetWindow && !widgetWindow.isDestroyed()) saveWidgetState({ bounds: widgetWindow.getBounds() }) }
  widgetWindow.on('moved', remember)
  widgetWindow.on('resized', remember)
  // Closed by hand (button, tray, Alt+F4) = stays closed next launch.
  // Closed because the app is quitting = comes back next launch.
  widgetWindow.on('close', () => { saveWidgetState({ bounds: widgetWindow.getBounds(), ...(isQuitting ? {} : { open: false }) }) })
  widgetWindow.on('closed', () => { widgetWindow = null; if (tray) rebuildTrayMenu(); widgetChanged() })
  saveWidgetState({ open: true })
  widgetChanged()
  if (tray) rebuildTrayMenu()
}

function closeWidget() {
  widgetWindow?.close()
}

ipcMain.handle('widget:toggle', () => (widgetWindow ? closeWidget() : createWidget()))
ipcMain.handle('widget:close', () => closeWidget())
ipcMain.handle('widget:state', () => ({ open: !!widgetWindow, onTop: !!loadWidgetState().onTop }))
ipcMain.handle('widget:on-top', (_e, on) => {
  saveWidgetState({ onTop: !!on })
  widgetWindow?.setAlwaysOnTop(!!on)
})
ipcMain.handle('widget:open-main', (_e, msg) => {
  if (msg && (msg.date || msg.id)) focusAndNavigate(msg)
  else if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() }
})
// Print the current view: render the page's print CSS to an A4 PDF (the week
// landscape, the R&D Summary portrait), ask where to save it, then open it.
// The renderer sends a file name, or { name, landscape }.
ipcMain.handle('print:pdf', async (e, arg) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = typeof arg === 'object' && arg ? arg : { name: arg }
  const landscape = opts.landscape !== false
  const pdf = await e.sender.printToPDF({ landscape, pageSize: 'A4', printBackground: true, scale: landscape ? 0.82 : 0.9, margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } })
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save as PDF',
    defaultPath: path.join(app.getPath('documents'), String(opts.name || 'WorkLog.pdf').replace(/[\\/:*?"<>|]/g, '-')),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return null
  fs.writeFileSync(filePath, pdf)
  shell.openPath(filePath)
  return filePath
})

// A reminder notification was clicked.
ipcMain.handle('app:focus', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

function rebuildTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open WorkLog', click: () => { mainWindow.show(); mainWindow.focus() } },
    { label: widgetWindow ? 'Hide calendar widget' : 'Show calendar widget', click: () => (widgetWindow ? closeWidget() : createWidget()) },
    { type: 'separator' },
    updateDownloaded
      ? { label: 'Restart to Install Update', click: () => { isQuitting = true; autoUpdater.quitAndInstall() } }
      : { label: 'Check for Updates', click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Quit WorkLog', click: () => { isQuitting = true; app.quit() } },
  ]))
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'))
  tray.setToolTip('WorkLog')
  rebuildTrayMenu()
  tray.on('click', () => { mainWindow.show(); mainWindow.focus() })
}

// Same show/focus idiom as the tray click and second-instance handlers above,
// plus a 'navigate' push to the already-loaded renderer — the only
// main-to-renderer IPC channel (everything else is renderer-initiated
// ipcMain.handle calls). The message is 'add' (global shortcut) or
// { view, date } / { id } from the month widget.
function focusAndNavigate(view) {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.webContents.send('navigate', view)
}

// Auto-update via electron-updater + GitHub Releases. A manual check (from
// the renderer's Settings page) always reports back — found, not found, or
// error; the periodic background check stays silent unless it actually
// finds something, so it doesn't nag.
let updateDownloaded = false
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true
  if (tray) rebuildTrayMenu()
  dialog.showMessageBox({
    type: 'info',
    title: 'WorkLog update ready',
    message: `WorkLog ${info.version} has been downloaded.`,
    detail: 'Restart now to install it, or it will install automatically the next time WorkLog quits.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) { isQuitting = true; autoUpdater.quitAndInstall() }
  })
})

autoUpdater.on('error', (err) => {
  console.error('autoUpdater error:', err)
})

// checkInProgress guards BOTH manual and periodic checks against the same
// shared autoUpdater event emitter, so a background tick firing mid-click
// can't steal the listeners registered for the user's own manual check (and
// vice versa). It's reset via .finally() on the check promise itself, not
// only from the event handlers below — a rejection that doesn't also emit
// 'error' used to leave it stuck true forever, silently disabling every
// future "Check for Updates" click until restart.
let checkInProgress = false
function checkForUpdates(manual) {
  if (isDev) return updateDownloaded ? 'downloaded' : 'skipped-dev'
  if (updateDownloaded) {
    if (manual) dialog.showMessageBox({ type: 'info', title: 'WorkLog', message: 'Update already downloaded — restart WorkLog to install it.' })
    return
  }
  if (checkInProgress) return // a check is already in flight — let it finish rather than racing a second one
  checkInProgress = true
  const cleanup = () => {
    autoUpdater.off('update-not-available', onNotAvailable)
    autoUpdater.off('update-available', onAvailable)
    autoUpdater.off('error', onError)
  }
  const onAvailable = (info) => {
    cleanup()
    if (manual) dialog.showMessageBox({
      type: 'info',
      title: 'WorkLog',
      message: `Update found: WorkLog ${info.version}`,
      detail: 'Downloading now — you\'ll get another prompt when it\'s ready to install.',
    })
  }
  const onNotAvailable = () => {
    cleanup()
    if (manual) dialog.showMessageBox({ type: 'info', title: 'WorkLog', message: "You're up to date." })
  }
  const onError = (err) => {
    cleanup()
    if (manual) dialog.showMessageBox({
      type: 'error',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: String((err && err.message) || err),
    })
  }
  autoUpdater.once('update-not-available', onNotAvailable)
  autoUpdater.once('update-available', onAvailable)
  autoUpdater.once('error', onError)
  autoUpdater.checkForUpdates()
    .catch(() => {}) // surfaced via the 'error' event above too — this just avoids an unhandled-rejection log
    .finally(() => { checkInProgress = false })
}

ipcMain.handle('updater:check', () => checkForUpdates(true))
ipcMain.handle('app:get-version', () => app.getVersion())

// Start with Windows (hidden, in the tray) so reminders and LINE messages go
// out without opening WorkLog. Packaged builds only. On by default the first
// time; after that the Settings switch decides.
function setLogin(on) {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] })
}
ipcMain.handle('login:get', () => (app.isPackaged ? app.getLoginItemSettings().openAtLogin : null))
ipcMain.handle('login:set', (_e, on) => { setLogin(on); saveWidgetState({ loginChosen: true }); return app.isPackaged ? app.getLoginItemSettings().openAtLogin : null })

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    createWindow()
    if (loadWidgetState().open) createWidget()
    if (!loadWidgetState().loginChosen) { setLogin(true); saveWidgetState({ loginChosen: true }) }
    try {
      createTray()
    } catch (err) {
      // A broken tray icon shouldn't take down the update timers below —
      // it did exactly that once already when the icon wasn't packaged.
      console.error('createTray failed:', err)
    }

    if (!isDev) {
      // Delay the first check past startup so it doesn't compete with the
      // dashboard's initial load, then recheck periodically since this is a
      // long-running desktop app that may stay open for days.
      setTimeout(() => checkForUpdates(false), 10_000)
      setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000)
    }

    // Global shortcut works even when WorkLog is minimized to tray/background —
    // the whole point, since that's its normal resting state (close-to-tray).
    const registered = globalShortcut.register('CommandOrControl+Shift+L', () => focusAndNavigate('add'))
    if (!registered) console.error('Failed to register global shortcut CommandOrControl+Shift+L')

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
