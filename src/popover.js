// Desktop hover detail: rest the pointer on any activity for a moment and a
// small card shows PV, lot, step, where and notes. Resting a little longer
// counts as "opened" and clears its change ring. Touch screens skip this.
import { state } from './store.js'
import { popHTML } from './activity.js'
import { markSeen } from './marks.js'

const SHOW_MS = 280
const SEEN_MS = 900
const canHover = matchMedia('(hover: hover) and (pointer: fine)')

export function initPopover(root) {
  const pop = document.createElement('div')
  pop.className = 'pop'
  pop.hidden = true
  document.body.appendChild(pop)
  let showT, seenT, current = null

  const hide = () => { clearTimeout(showT); clearTimeout(seenT); pop.hidden = true; current = null }
  const place = el => {
    const r = el.getBoundingClientRect()
    const w = pop.offsetWidth, h = pop.offsetHeight
    let x = r.left, y = r.bottom + 6
    if (x + w > innerWidth - 8) x = innerWidth - w - 8
    if (y + h > innerHeight - 8) y = r.top - h - 6
    pop.style.left = `${Math.max(8, x)}px`
    pop.style.top = `${Math.max(8, y)}px`
  }

  root.addEventListener('mouseover', e => {
    if (!canHover.matches) return
    const el = e.target.closest('[data-pop]')
    if (el === current) return
    hide()
    if (!el) return
    current = el
    showT = setTimeout(() => {
      const t = state.tasks.find(x => x.id === el.dataset.pop)
      if (!t || !el.isConnected) return
      pop.innerHTML = popHTML(t)
      pop.hidden = false
      place(el)
      if (el.classList.contains('marked')) seenT = setTimeout(() => clearMark(root, t.id), SEEN_MS)
    }, SHOW_MS)
  })
  root.addEventListener('mouseleave', hide)
  root.addEventListener('click', hide, true)
  root.addEventListener('scroll', hide, true)
  window.addEventListener('blur', hide)
}

// Drop the ring everywhere that row is drawn, without a full re-render.
export function clearMark(root, id) {
  if (!markSeen(id)) return
  root.querySelectorAll(`[data-id="${CSS.escape(id)}"].marked`).forEach(el => {
    el.classList.remove('marked')
    el.querySelector('.mk')?.remove()
  })
  root.querySelector('.changes-box')?.dispatchEvent(new CustomEvent('marks-changed', { bubbles: true }))
}
