const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, msg) => cb(msg)),
  focusMain: () => ipcRenderer.invoke('app:focus'),
  login: {
    get: () => ipcRenderer.invoke('login:get'),
    set: (on) => ipcRenderer.invoke('login:set', on),
  },
  printPdf: (name) => ipcRenderer.invoke('print:pdf', name),
  // The pinned month widget (a second, frameless window).
  widget: {
    toggle: () => ipcRenderer.invoke('widget:toggle'),
    close: () => ipcRenderer.invoke('widget:close'),
    getState: () => ipcRenderer.invoke('widget:state'),
    setOnTop: (on) => ipcRenderer.invoke('widget:on-top', on),
    openMain: (msg) => ipcRenderer.invoke('widget:open-main', msg),
  },
})
