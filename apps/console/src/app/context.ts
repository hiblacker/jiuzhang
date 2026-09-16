import { inject } from 'vue'
import type { InjectionKey } from 'vue'
import type { Pinia } from 'pinia'
import { createTransport, validateBase } from '../api/transport.ts'
import type { Project } from '../shared/types.ts'
import { useProjectStore } from '../stores/project.ts'
import { useSessionStore } from '../stores/session.ts'
import type { AccessMode } from '../stores/session.ts'

export function createConsoleContext(pinia: Pinia, fetcher: typeof fetch = fetch) {
  const session = useSessionStore(pinia)
  const projects = useProjectStore(pinia)
  // Credentials never enter Pinia state, action arguments, persistence or devtools snapshots.
  let token = ''
  let projectRequest = 0
  const transport = createTransport(
    () => ({ base: session.base, token, generation: session.generation }),
    disconnect,
    fetcher,
  )

  function disconnect() {
    session.invalidate()
    token = ''
    projectRequest++
    transport.abort()
    projects.reset()
  }

  async function loadProjects() {
    const requestId = ++projectRequest
    const generation = session.generation
    const rows = await transport.request<Project[]>('warehouse/projects')
    if (requestId === projectRequest && generation === session.generation) {
      projects.replace(rows)
    }
  }

  async function connect(base: string, credential: string, mode: AccessMode) {
    const url = validateBase(base)
    if (!credential.trim()) {
      throw new Error('请输入访问令牌')
    }
    disconnect()
    token = credential.trim()
    session.begin(url, mode)
    const generation = session.generation
    try {
      await loadProjects()
      if (generation !== session.generation) {
        throw new DOMException('Session changed', 'AbortError')
      }
      session.complete()
    }
    catch (error) {
      if (generation === session.generation) {
        disconnect()
      }
      throw error
    }
  }

  return { request: transport.request, connect, disconnect, loadProjects, session, projects }
}

export type ConsoleContext = ReturnType<typeof createConsoleContext>
export const consoleContextKey: InjectionKey<ConsoleContext> = Symbol('console-context')

export function useConsoleContext() {
  const context = inject(consoleContextKey)
  if (!context) {
    throw new Error('Console context is not installed')
  }
  return context
}
