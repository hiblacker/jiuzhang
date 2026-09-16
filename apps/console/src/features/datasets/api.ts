import type { Dataset, QueryResult } from '../../shared/types'
import type { ScopedRequest } from '../../api/client'
import type {
  Build,
  BuildInput,
  ModelInput,
  ModelVersion,
  PolicyInput,
  QueryInput,
  Release,
} from './types'

export function datasetApi(call: ScopedRequest, project: number) {
  const base = `warehouse/projects/${project}`
  const path = (id: number) => `${base}/datasets/${id}`
  return {
    list: () => call<Dataset[]>(`${base}/datasets`),
    versions: (id: number) => call<ModelVersion[]>(`${path(id)}/versions`),
    releases: (id: number) => call<Release[]>(`${path(id)}/releases`),
    builds: (id: number) => call<Build[]>(`${path(id)}/builds`),
    register: (body: ModelInput) => call<{ id: number }>(`${base}/models`, body),
    build: (id: number, body: BuildInput) => call(`${path(id)}/builds`, body),
    impact: (id: number, version: number) => call(`${path(id)}/impact?version=${version}`),
    publish: (id: number, build: number, reason: string) =>
      call(`${path(id)}/builds/${build}/publish`, { reason }),
    cancel: (id: number, build: number) => call(`${path(id)}/builds/${build}/cancel`, {}),
    policy: (id: number, body: PolicyInput) => call(`${path(id)}/policy`, body),
    query: (id: number, body: QueryInput) => call<QueryResult>(`${path(id)}/query`, body),
    export: (id: number, body: QueryInput) => call<Blob>(`${path(id)}/export`, body, true),
  }
}

export type DatasetApi = ReturnType<typeof datasetApi>
