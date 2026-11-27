// The live web app. One copy, used by the app (src/config.js), the LINE cards
// (lib/lineCards.js) and the server (lib/server.js).
export const WEB = 'https://worklog-mauve.vercel.app'
// Orbit card button when there is no view link: the signed-in read-only app,
// opened in the phone's own browser rather than LINE's.
export const VIEW_URL = `${WEB}/?view=1&openExternalBrowser=1`
