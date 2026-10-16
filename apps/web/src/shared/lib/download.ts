export function downloadText(name: string, content: string, type = 'text/plain') {
  const safe = safeDownloadName(name)
  const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = safe
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
export function safeDownloadName(name: string) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^[.]+/, '') || 'download.txt'
}
