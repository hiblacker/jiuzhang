import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { Project } from './types'
import { ApiError, createTransport } from './transport'
export { ApiError, validateBase } from './transport'
export const session = reactive({
  base: window.location.origin,
  token: '',
  mode: 'admin',
  connected: false,
  generation: 0,
})
export const projects = ref<Project[]>([])
export const projectId = ref<number | null>(null)
export const project = computed(() => projects.value.find(p => p.id === projectId.value))
export const owner = computed(() => project.value?.role === 'OWNER')
export const engineer = computed(() => ['OWNER', 'ENGINEER'].includes(project.value?.role ?? ''))
const transport = createTransport(() => session, disconnect)
export const request = transport.request
export function disconnect() {
  session.generation++
  transport.abort()
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
    if (loading.value || controller.signal.aborted) {
      return
    }
    loading.value = true
    error.value = ''
    try {
      return await action()
    }
    catch (e) {
      if (!controller.signal.aborted && !(e instanceof DOMException && e.name === 'AbortError')) {
        error.value = errorText(e)
      }
    }
    finally {
      loading.value = false
    }
  }
  return {
    loading,
    error,
    run,
    call: <T>(route: string, body?: unknown, csv = false) =>
      request<T>(route, body, controller.signal, csv),
  }
}
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return '会话已失效，请重新连接。'
    }
    if (error.status === 403) {
      return `无权执行此操作（${error.code}）`
    }
    if (error.status === 409) {
      return `数据状态已变化，请刷新后重试（${error.code}）`
    }
    return `操作未完成（${error.code}）`
  }
  if (error instanceof TypeError) {
    return '无法连接控制 API，请检查地址、网络与跨域配置。'
  }
  return error instanceof Error ? error.message : '操作未完成'
}
let projectRequest = 0
export async function loadProjects() {
  const requestId = ++projectRequest
  const rows = await request<Project[]>('warehouse/projects')
  if (requestId !== projectRequest) {
    return
  }
  projects.value = rows
  if (!rows.some(p => p.id === projectId.value)) {
    projectId.value = rows[0]?.id ?? null
  }
}
