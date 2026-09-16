let csrf: { headerName: string; token: string } | null = null
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId = '') { super(message) }
}
export async function csrfToken() {
  const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('暂时无法连接服务')
  csrf = await response.json() as { headerName: string; token: string }
  return csrf
}
export async function api<T = Record<string, unknown>>(path: string, body?: unknown, form = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) {
    const token = csrf || await csrfToken()
    headers[token.headerName] = token.token
    headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json'
  }
  const response = await fetch(`/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers, credentials: 'same-origin',
    body: body === undefined ? undefined : form ? String(body) : JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'))
    if (response.status === 403) csrf = null
    throw new ApiError(response.status, error.code || 'REQUEST_FAILED', error.message || '操作未成功', error.requestId || response.headers.get('X-Request-Id') || '')
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}
export async function login(username: string, password: string) {
  await csrfToken()
  await api('/auth/login', new URLSearchParams({ username, password }), true)
  await csrfToken()
}
export async function logout() { await api('/auth/logout', {}); csrf = null }
export interface Project { id: number; name: string; code: string; role: 'OWNER'|'ENGINEER'|'VIEWER' }
export interface Identity { identity: string; platformAdmin: boolean; projects: Project[] }
export interface Page<T> { items: T[]; total: number; limit: number; offset: number }
