import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export type Source = Model<'Source'>
export type SourceInput = Model<'SourceInput'>
export interface SourceFilters {
  q: string
  type: string
  status: string
  page: number
  pageSize: number
  sort: string
}
export const sourceRepository = {
  async list(filters: SourceFilters, signal?: AbortSignal) {
    return unwrap(
      await api.GET('/sources', {
        params: {
          query: { ...filters, page: String(filters.page), pageSize: String(filters.pageSize) },
        },
        signal,
      }),
    )
  },
  async get(id: string, signal?: AbortSignal) {
    return unwrap(await api.GET('/sources/{id}', { params: { path: { id } }, signal })).data
  },
  async save(input: SourceInput, id?: string) {
    return id
      ? unwrap(await api.PATCH('/sources/{id}', { params: { path: { id } }, body: input })).data
      : unwrap(await api.POST('/sources', { body: input })).data
  },
  async remove(id: string) {
    return unwrap(await api.DELETE('/sources/{id}', { params: { path: { id } } })).data
  },
  async test(input: SourceInput, id?: string) {
    const body =
      import.meta.env.VITE_API_MODE === 'real' && id ? { ...input, credentialSourceId: id } : input
    return unwrap(await api.POST('/sources/test', { body })).data
  },
  async objects(id: string, signal?: AbortSignal) {
    return unwrap(await api.GET('/sources/{id}/objects', { params: { path: { id } }, signal })).data
  },
  async preview(id: string, objectId: string) {
    return unwrap(
      await api.POST('/sources/{id}/preview', { params: { path: { id } }, body: { objectId } }),
    ).data
  },
}
