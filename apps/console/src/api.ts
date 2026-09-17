import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { Project as TokenProject } from './types'
import { ApiError as TokenApiError, createTransport } from './transport'

let csrf: { headerName: string; token: string } | null = null
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId = '') { super(message===code?message:`${message} (${code})`) }
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
export async function exportCsv(path: string, body: unknown, filename: string) {
  const token=csrf||await csrfToken()
  const response=await fetch(`/api/v1${path}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',[token.headerName]:token.token},body:JSON.stringify(body)})
  if(!response.ok){const error=await response.json().catch(()=>({}));if(response.status===401)window.dispatchEvent(new Event('session-expired'));throw new ApiError(response.status,error.code||'EXPORT_FAILED',error.message||'导出失败')}
  const url=URL.createObjectURL(await response.blob()),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

// Compatibility exports for the token-console components retained from main.
// The account workbench above is the active entry point; these keep the reviewed
// transport and workspace modules buildable while their flows are consolidated.
export { validateBase } from './transport'
export const session = reactive({ base: window.location.origin, token: '', mode: 'admin', connected: false, generation: 0 })
export const projects = ref<TokenProject[]>([])
export const projectId = ref<number | null>(null)
export const project = computed(() => projects.value.find(item => item.id === projectId.value))
export const owner = computed(() => project.value?.role === 'OWNER')
export const engineer = computed(() => ['OWNER', 'ENGINEER'].includes(project.value?.role ?? ''))
const tokenTransport = createTransport(() => session, disconnect)
export const request = tokenTransport.request

export function disconnect() {
  session.generation++
  tokenTransport.abort()
  session.connected = false
  session.token = ''
  projects.value = []
  projectId.value = null
}

export function useApi() {
  const controller = new AbortController()
  const loading = ref(false)
  const error = ref('')
  onScopeDispose(() => controller.abort())
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (loading.value || controller.signal.aborted) return
    loading.value = true
    error.value = ''
    try { return await action() }
    catch (cause) {
      if (!controller.signal.aborted && !(cause instanceof DOMException && cause.name === 'AbortError')) error.value = errorText(cause)
    } finally { loading.value = false }
  }
  return { loading, error, run, call: <T>(route: string, body?: unknown, csv = false) => request<T>(route, body, controller.signal, csv) }
}

export function errorText(cause: unknown): string {
  if (cause instanceof TokenApiError) {
    if (cause.status === 401) return '会话已失效，请重新连接。'
    if (cause.status === 403) return `无权执行此操作（${cause.code}）`
    if (cause.status === 409) return `数据状态已变化，请刷新后重试（${cause.code}）`
    return `操作未完成（${cause.code}）`
  }
  if (cause instanceof TypeError) return '无法连接控制 API，请检查地址、网络与跨域配置。'
  return cause instanceof Error ? cause.message : '操作未完成'
}

let tokenProjectRequest = 0
export async function loadProjects() {
  const requestId = ++tokenProjectRequest
  const rows = await request<TokenProject[]>('warehouse/projects')
  if (requestId !== tokenProjectRequest) return
  projects.value = rows
  if (!rows.some(item => item.id === projectId.value)) projectId.value = rows[0]?.id ?? null
}
