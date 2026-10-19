import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export const warehouseRepository = {
  async subjectDomains(signal?: AbortSignal) {
    return unwrap(await api.GET('/warehouse/subject-domains', { signal })).data
  },
  async metrics(tableId = '', signal?: AbortSignal) {
    return unwrap(await api.GET('/warehouse/metrics', { params: { query: { tableId } }, signal }))
      .data
  },
  async tables(query: Record<string, string> = {}, signal?: AbortSignal) {
    return unwrap(await api.GET('/warehouse/tables', { params: { query }, signal }))
  },
  async table(id: string, signal?: AbortSignal) {
    return unwrap(await api.GET('/warehouse/tables/{id}', { params: { path: { id } }, signal }))
      .data
  },
  async query(body: Model<'QueryInput'>) {
    return unwrap(await api.POST('/queries', { body })).data
  },
  async queryDetail(id: string) {
    return unwrap(await api.GET('/queries/{id}', { params: { path: { id } } })).data
  },
  async cancelQuery(id: string) {
    return unwrap(await api.POST('/queries/{id}/cancel', { params: { path: { id } } })).data
  },
  async queries(query: Record<string, string> = {}, signal?: AbortSignal) {
    return unwrap(await api.GET('/queries', { params: { query }, signal }))
  },
  async imports(query: Record<string, string> = {}, signal?: AbortSignal) {
    return unwrap(await api.GET('/imports', { params: { query }, signal }))
  },
  async import(body: Model<'ImportInput'>) {
    return unwrap(await api.POST('/imports', { body })).data
  },
  async exports(query: Record<string, string> = {}, signal?: AbortSignal) {
    return unwrap(await api.GET('/exports', { params: { query }, signal }))
  },
  async exportDetail(id: string) {
    return unwrap(await api.GET('/exports/{id}', { params: { path: { id } } })).data
  },
  async export(body: Model<'ExportInput'>) {
    return unwrap(
      await api.POST('/exports', {
        body:
          import.meta.env.VITE_API_MODE === 'real'
            ? { queryId: body.queryId, format: body.format }
            : body,
      }),
    ).data
  },
}
