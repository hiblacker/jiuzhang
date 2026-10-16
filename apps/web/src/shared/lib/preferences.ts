const prefix = 'jiuzhang.preference.'
export function readPreference(key: string, fallback: string) {
  try {
    return localStorage.getItem(prefix + key) ?? fallback
  } catch {
    return fallback
  }
}
export function writePreference(key: string, value: string) {
  localStorage.setItem(prefix + key, value)
}
