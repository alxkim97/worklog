'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wl', {
  // Config
  getConfig:         ()       => ipcRenderer.invoke('get-config'),
  saveSupabase:      (cfg)    => ipcRenderer.invoke('save-supabase', cfg),
  saveGoogleCreds:   (cfg)    => ipcRenderer.invoke('save-google-creds', cfg),
  saveTheme:         (t)      => ipcRenderer.invoke('save-theme', t),
  saveView:          (v)      => ipcRenderer.invoke('save-view', v),
  saveSyncInterval:  (h)      => ipcRenderer.invoke('save-sync-interval', h),
  saveColors:        (colors) => ipcRenderer.invoke('save-colors', colors),

  // Google OAuth
  googleConnect:    ()  => ipcRenderer.invoke('google-connect'),
  googleDisconnect: ()  => ipcRenderer.invoke('google-disconnect'),

  // Sync
  syncNow: () => ipcRenderer.invoke('sync-now'),
  onSyncComplete: (cb) => {
    const handler = (_, result) => cb(result);
    ipcRenderer.on('sync-complete', handler);
    return () => ipcRenderer.removeListener('sync-complete', handler);
  },

  // Tasks CRUD
  tasksGetAll:   ()               => ipcRenderer.invoke('tasks-get-all'),
  tasksCreate:   (task)           => ipcRenderer.invoke('tasks-create', task),
  tasksUpdate:   (id, updates)    => ipcRenderer.invoke('tasks-update', { id, updates }),
  tasksDelete:   (id)             => ipcRenderer.invoke('tasks-delete', id),
  tasksBulkDelete: (ids)          => ipcRenderer.invoke('tasks-bulk-delete', ids)
});
