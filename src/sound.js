// A short, soft two-note chime made with WebAudio (no sound file). Plays with
// reminder and plan-change notifications unless switched off in Settings.
import { state } from './store.js'

let ctx = null
let last = 0

function tone(at, freq, out) {
  // a sine plus a quiet octave partial gives a soft bell colour
  for (const [mult, level] of [[1, 1], [2, 0.18]]) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq * mult
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(level, at + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.9)
    o.connect(g).connect(out)
    o.start(at)
    o.stop(at + 0.95)
  }
}

// force: the Settings test button plays even when the sound is off.
export function playChime({ force = false } = {}) {
  if (!force && state.prefs.sound === false) return
  // several reminders firing together make one chime, not a pile-up
  if (Date.now() - last < 1500) return
  last = Date.now()
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    const out = ctx.createGain()
    out.gain.value = 0.16
    out.connect(ctx.destination)
    const t = ctx.currentTime + 0.03
    tone(t, 880, out)          // A5
    tone(t + 0.13, 1318.5, out) // E6
  } catch {} // no audio device / blocked: notifications still show
}
