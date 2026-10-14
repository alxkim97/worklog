// WorkLog's own Supabase project (the one v1 used). The anon key is public
// by design — every table is locked to worklog_members by RLS.
export const SUPABASE_URL = ''
export const SUPABASE_ANON_KEY = ''

// Where api/sync-sheet lives. Same origin on the web; the Electron build
// (file://) and the Vite dev server have no /api, so they call the deploy.
export const WEB_URL = ''

export const API_BASE = location.protocol === 'file:' || import.meta.env.DEV ? WEB_URL : ''

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY)
