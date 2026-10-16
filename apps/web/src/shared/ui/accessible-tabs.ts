import type { ObjectDirective } from 'vue'

let nextId = 0
const dispose = new WeakMap<HTMLElement, () => void>()

/** Adds keyboard/ARIA behavior missing from the installed Naive UI tabs. */
export const vAccessibleTabs: ObjectDirective<HTMLElement, string> = {
  mounted(root, binding) {
    const prefix = 'workspace-tabs-' + ++nextId
    const tabs = () =>
      [...root.querySelectorAll<HTMLElement>('.n-tabs-tab')].filter(
        (tab) => tab.closest('.n-tabs') === root,
      )
    let selected: HTMLElement | undefined
    let frame = 0
    function reveal(tab: HTMLElement) {
      const viewport = root.querySelector<HTMLElement>('.v-x-scroll')
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      const target = tab.getBoundingClientRect()
      if (target.left < bounds.left) viewport.scrollLeft += target.left - bounds.left
      else if (target.right > bounds.right) viewport.scrollLeft += target.right - bounds.right
    }
    function queueReveal(tab: HTMLElement) {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => reveal(tab))
    }
    function sync() {
      const items = tabs()
      const active = items.findIndex((tab) => tab.classList.contains('n-tabs-tab--active'))
      if (selected !== items[active]) {
        selected = items[active]
        if (selected) queueReveal(selected)
      }
      const list = root.querySelector<HTMLElement>('.n-tabs-nav-scroll-content')
      if (list) {
        list.setAttribute('role', 'tablist')
        list.setAttribute('aria-label', root.dataset.tabsLabel ?? '')
        list.setAttribute('aria-orientation', 'horizontal')
      }
      items.forEach((tab, index) => {
        const disabled = tab.dataset.disabled === 'true'
        tab.id = prefix + '-tab-' + index
        tab.setAttribute('role', 'tab')
        tab.setAttribute('aria-selected', String(index === active))
        tab.setAttribute('aria-disabled', String(disabled))
        tab.setAttribute('aria-controls', prefix + '-panel-' + index)
        tab.tabIndex = index === active && !disabled ? 0 : -1
      })
      for (const panel of root.querySelectorAll<HTMLElement>('.n-tab-pane')) {
        if (panel.closest('.n-tabs') !== root) continue
        const leaving = [...panel.classList].some((name) => name.includes('-leave-'))
        if (leaving || panel.style.display === 'none') {
          panel.setAttribute('aria-hidden', 'true')
          panel.tabIndex = -1
          continue
        }
        panel.id = prefix + '-panel-' + active
        panel.setAttribute('role', 'tabpanel')
        panel.setAttribute('aria-labelledby', prefix + '-tab-' + active)
        panel.removeAttribute('aria-hidden')
        panel.tabIndex = 0
      }
    }
    function focus(event: FocusEvent) {
      if (!(event.target instanceof HTMLElement)) return
      const target = event.target.closest<HTMLElement>('.n-tabs-tab')
      if (!target || !tabs().includes(target)) return
      for (const tab of tabs()) tab.tabIndex = tab === target ? 0 : -1
      queueReveal(target)
    }
    function keyboard(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement))
        return
      const target = event.target.closest<HTMLElement>('.n-tabs-tab')
      const items = tabs().filter((tab) => tab.dataset.disabled !== 'true')
      if (!target || !items.includes(target)) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        target.click()
        return
      }
      const index = items.indexOf(target)
      let destination: HTMLElement | undefined
      if (event.key === 'ArrowRight') destination = items[(index + 1) % items.length]
      else if (event.key === 'ArrowLeft')
        destination = items[(index - 1 + items.length) % items.length]
      else if (event.key === 'Home') destination = items[0]
      else if (event.key === 'End') destination = items.at(-1)
      if (!destination) return
      event.preventDefault()
      destination.focus()
      queueReveal(destination)
    }
    root.dataset.tabsLabel = binding.value
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    const resize = new ResizeObserver(() => {
      const focused = tabs().find((tab) => tab === document.activeElement)
      const target = focused ?? selected
      if (target) queueReveal(target)
    })
    const viewport = root.querySelector<HTMLElement>('.v-x-scroll')
    if (viewport) resize.observe(viewport)
    root.addEventListener('keydown', keyboard)
    root.addEventListener('focusin', focus)
    dispose.set(root, () => {
      observer.disconnect()
      resize.disconnect()
      cancelAnimationFrame(frame)
      root.removeEventListener('keydown', keyboard)
      root.removeEventListener('focusin', focus)
    })
  },
  updated(root, binding) {
    root.dataset.tabsLabel = binding.value
    root.querySelector('[role="tablist"]')?.setAttribute('aria-label', binding.value)
  },
  unmounted(root) {
    dispose.get(root)?.()
    dispose.delete(root)
  },
}
