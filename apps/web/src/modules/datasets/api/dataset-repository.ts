import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export type DatasetInput = Model<'DatasetInput'>
export const datasetRepository = {
  async list(query: Record<string, string>, signal?: AbortSignal) {
    return unwrap(await api.GET('/datasets', { params: { query }, signal }))
  },
  async get(id: string, signal?: AbortSignal) {
    return unwrap(await api.GET('/datasets/{id}', { params: { path: { id } }, signal })).data
  },
  async save(body: DatasetInput, id?: string) {
    return id
      ? unwrap(await api.PATCH('/datasets/{id}', { params: { path: { id } }, body })).data
      : unwrap(await api.POST('/datasets', { body })).data
  },
  async remove(id: string) {
    return unwrap(await api.DELETE('/datasets/{id}', { params: { path: { id } } })).data
  },
  async publish(id: string) {
    return unwrap(await api.POST('/datasets/{id}/publish', { params: { path: { id } } })).data
  },
  async preview(body: DatasetInput) {
    return unwrap(await api.POST('/datasets/preview', { body })).data
  },
  async previewSaved(id: string) {
    return unwrap(await api.POST('/datasets/{id}/preview', { params: { path: { id } } })).data
  },
  async query(id: string, limit = 100) {
    return unwrap(
      await api.POST('/datasets/{id}/query', { params: { path: { id } }, body: { limit } }),
    ).data
  },
  async versions(id: string) {
    return unwrap(await api.GET('/datasets/{id}/versions', { params: { path: { id } } })).data
  },
  async version(id: string, version: string, signal?: AbortSignal) {
    return unwrap(
      await api.GET('/datasets/{id}/versions/{version}', {
        params: { path: { id, version } },
        signal,
      }),
    ).data
  },
  async restore(id: string, version: string) {
    return unwrap(
      await api.POST('/datasets/{id}/versions/{version}/restore', {
        params: { path: { id, version } },
      }),
    ).data
  },
}
