import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export type Source = Model<'Source'>
export type SourceInput = Model<'SourceInput'>
export type ExcelFile = Model<'ExcelFile'>
export interface SourceFilters {
  q: string
  type: string
  status: string
  page: number
  pageSize: number
  sort: string
}
export const sourceRepository = {
  async fileInfo(id: string) {
    return unwrap(await api.GET('/sources/excel-files/{id}', { params: { path: { id } } })).data
  },
  async upload(file: File) {
    const body = new FormData()
    body.append('file', file)
    return unwrap(
      await api.POST('/sources/excel-files', {
        body: { file: '' },
        bodySerializer: () => body,
      }),
    ).data
  },
  async previewFile(id: string, sheet: string, headerRow: number) {
    return unwrap(
      await api.POST('/sources/excel-files/{id}/preview', {
        params: { path: { id } },
        body: { sheet, headerRow },
      }),
    ).data
  },
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
    const body = id ? { ...input, credentialSourceId: id } : input
    return unwrap(await api.POST('/sources/test', { body })).data
  },
  async objects(id: string, signal?: AbortSignal) {
    return unwrap(await api.GET('/sources/{id}/objects', { params: { path: { id } }, signal })).data
  },
}
