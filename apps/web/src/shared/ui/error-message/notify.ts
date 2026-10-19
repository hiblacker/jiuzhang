const eventName = 'jiuzhang:error-message'
const recentlyReported = new WeakMap<object, number>()

export function notifyUiError(error: unknown) {
  if (typeof window === 'undefined') return
  if (typeof error === 'object' && error !== null) {
    const now = Date.now()
    const previous = recentlyReported.get(error)
    if (previous !== undefined && now - previous < 1000) return
    recentlyReported.set(error, now)
  }
  window.dispatchEvent(new CustomEvent(eventName, { detail: error }))
}

export { eventName as uiErrorMessageEvent }
