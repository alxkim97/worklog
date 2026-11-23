// Entry point. The desktop app opens the same bundle twice: the main window,
// and the pinned month widget (main.cjs loads it with #widget).
import './style.css'

if (location.hash === '#widget') import('./widget.js')
else import('./app.js')
