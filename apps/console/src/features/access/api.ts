import type { ScopedRequest } from '../../api/client'
import type { Role } from '../../shared/types'

export interface Identity {
  id: string
  enabled: boolean
  created_at?: string
}
export interface Member {
  identity_id: string
  role: Role
  enabled: boolean
}
export interface ProjectSource {
  id: number
  code: string
  source_type: string
}
export interface ProjectInput {
  code: string
  name: string
  description: string
}
export interface MemberInput {
  identity: string
  role: Role
}

export function accessApi(call: ScopedRequest, project: number | null) {
  const path = () => {
    if (!project) {
      throw new Error('请先选择项目')
    }
    return `warehouse/projects/${project}`
  }
  return {
    identities: () => call<Identity[]>('warehouse/identities'),
    sources: () => call<ProjectSource[]>(`${path()}/sources`),
    members: () => call<Member[]>(`${path()}/members`),
    project: (input: ProjectInput) => call('warehouse/projects', input),
    identity: (id: string) => call<{ id: string, token: string }>('warehouse/identities', { id }),
    member: (input: MemberInput) => call(`${path()}/members`, input),
    bind: (sourceCode: string) => call(`${path()}/sources`, { sourceCode }),
    revoke: (id: string) => call(`warehouse/identities/${encodeURIComponent(id)}/revoke`, {}),
  }
}
