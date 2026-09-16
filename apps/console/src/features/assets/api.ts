import type { ScopedRequest } from '../../api/client'

export interface Asset {
  id: string
  name: string
  source_code: string
  kind: string
  state: string
  row_count: number
  data_window: string
  run_id: number
  contract_version: number
}
export function assetApi(call: ScopedRequest, project: number) {
  const base = `warehouse/projects/${project}`
  return {
    list: (offset: number) => call<Asset[]>(`${base}/assets?limit=100&offset=${offset}`),
    detail: (id: string) => call(`${base}/assets/${encodeURIComponent(id)}`),
    coverage: (run: number) => call(`${base}/coverage/${run}`),
  }
}
