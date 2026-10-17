import type { ObjectDirective } from 'vue'

const observers = new WeakMap<HTMLElement, MutationObserver>()

/** Names the focusable trigger in the installed Naive UI select-only controls. */
export const vSelectTriggerName: ObjectDirective<HTMLElement, string> = {
  mounted(root, binding) {
    root.dataset.selectLabel = binding.value
    const sync = () => {
      const selection = root.querySelector('.n-base-selection')
      const trigger = root.querySelector<HTMLElement>(
        '.n-base-selection-label, .n-base-selection-tags',
      )
      if (!trigger) return
      const disabled = selection?.classList.contains('n-base-selection--disabled') ?? false
      trigger.setAttribute('role', 'button')
      trigger.setAttribute('aria-label', root.dataset.selectLabel ?? '')
      trigger.setAttribute('aria-disabled', String(disabled))
      trigger.setAttribute(
        'aria-expanded',
        String(!disabled && (selection?.classList.contains('n-base-selection--active') ?? false)),
      )
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'tabindex', 'data-select-label'],
    })
    observers.set(root, observer)
  },
  updated(root, binding) {
    root.dataset.selectLabel = binding.value
  },
  unmounted(root) {
    observers.get(root)?.disconnect()
    observers.delete(root)
  },
}
