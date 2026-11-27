// Renders a message model (lib/messages.js) as a LINE Flex "bubble": a
// violet header, sections with bold names and coloured status words, and an
// "Open WorkLog" button. The button opens the web app read-only (?view=1) in
// the phone's own browser (openExternalBrowser=1), where you're signed in.

import { VIEW_URL } from './urls.js'
export { VIEW_URL }

const C = {
  head: '#6d4aff', headInk: '#ffffff', headSub: '#e7e0ff',
  ink: '#1b1830', ink2: '#5a5575', muted: '#8a85a3', line: '#ece9f5',
  good: '#11a36b', bad: '#e5384f', warn: '#c27400',
}
const MAX_ROWS = 12      // per section
const MAX_SECTIONS = 9   // keeps the bubble well under LINE's 30 KB limit

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const text = (t, o = {}) => ({ type: 'text', text: clip(String(t), 600), wrap: true, ...o })
const span = (t, o = {}) => ({ type: 'span', text: String(t), ...o })

// Rows (see lib/messages.js):
//   { lead, bold, tag }  → one line: step (muted) · date (bold) · tag (coloured)
//   { bold, sub }        → bold line, detail line(s) under it in small type
//   { text }             → a plain line
function row(r) {
  const tone = r.tone ? C[r.tone] : null
  if (r.tag) {
    return {
      type: 'text', wrap: true, size: 'sm', contents: [
        ...(r.lead ? [span(`${r.lead}   `, { color: C.ink2 })] : []),
        span(r.bold || '—', { weight: 'bold', color: C.ink }),
        span(`   ${r.tag}`, { weight: 'bold', color: tone || C.muted, size: 'xs' }),
      ],
    }
  }
  if (r.bold) {
    return {
      type: 'box', layout: 'vertical', spacing: 'none', contents: [
        text(r.bold, { weight: 'bold', size: 'sm', color: tone && !r.sub ? tone : C.ink }),
        ...(r.sub ? [text(r.sub, { size: 'xs', color: tone || C.ink2 })] : []),
      ],
    }
  }
  return text(r.text || '—', { size: 'sm', color: tone || C.ink2 })
}

function section(s) {
  const head = s.title ? [text(s.title, { weight: 'bold', size: 'sm', color: C.ink })]
    : s.label ? [text(s.label.toUpperCase(), { weight: 'bold', size: 'xxs', color: C.muted })] : []
  const rows = s.rows.slice(0, MAX_ROWS).map(row)
  if (s.rows.length > MAX_ROWS) rows.push(text(`+${s.rows.length - MAX_ROWS} more`, { size: 'xs', color: C.muted }))
  return { type: 'box', layout: 'vertical', spacing: 'sm', contents: [...head, ...rows] }
}

export function card(m, { link = VIEW_URL } = {}) {
  const body = []
  m.sections.slice(0, MAX_SECTIONS).forEach((s, i) => {
    if (i) body.push({ type: 'separator', color: C.line })
    body.push(section(s))
  })
  if (m.note) body.push(text(m.note, { size: 'xs', color: C.muted, ...(body.length ? {} : { size: 'sm', color: C.ink2 }) }))
  if (!body.length) body.push(text('Nothing to show.', { size: 'sm', color: C.muted }))
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: C.head, paddingAll: '16px', spacing: 'xs',
      contents: [
        text(m.title, { weight: 'bold', size: 'lg', color: C.headInk }),
        ...(m.subtitle ? [text(m.subtitle, { size: 'xs', color: C.headSub })] : []),
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: body },
    footer: {
      type: 'box', layout: 'vertical', paddingAll: '8px',
      contents: [{ type: 'button', style: 'link', height: 'sm', color: C.head, action: { type: 'uri', label: 'Open WorkLog (view)', uri: link } }],
    },
  }
}

// The LINE message object: a Flex message with a short preview (altText is
// what the phone's notification shows; max 400 characters).
export const flexMessage = (m, opts) => ({ type: 'flex', altText: clip(m.alt || m.title, 400), contents: card(m, opts) })
