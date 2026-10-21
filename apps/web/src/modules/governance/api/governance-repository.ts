import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export const governanceRepository = {
  async quality(query: Record<string, string> = {}, signal?: AbortSignal) {
    return unwrap(await api.GET('/governance/quality', { params: { query }, signal }))
  },
  async masking(query: Record<string, string> = {}, signal?: AbortSignal) {
    return unwrap(await api.GET('/governance/masking', { params: { query }, signal }))
  },
  async catalog(query: Record<string, string> = {}) {
    return unwrap(await api.GET('/governance/catalog', { params: { query } }))
  },
  async lineage(scope: 'resource' | 'field' = 'resource') {
    return unwrap(await api.GET('/governance/lineage', { params: { query: { scope } } })).data
  },
  async qualityDetail(id: string, signal?: AbortSignal) {
    return unwrap(await api.GET('/governance/quality/{id}', { params: { path: { id } }, signal }))
      .data
  },
  async maskDetail(id: string, signal?: AbortSignal) {
    return unwrap(await api.GET('/governance/masking/{id}', { params: { path: { id } }, signal }))
      .data
  },
  async saveQuality(body: Model<'QualityInput'>, id?: string) {
    return id
      ? unwrap(await api.PATCH('/governance/quality/{id}', { params: { path: { id } }, body })).data
      : unwrap(await api.POST('/governance/quality', { body })).data
  },
  async saveMask(body: Model<'MaskingInput'>, id?: string) {
    return id
      ? unwrap(await api.PATCH('/governance/masking/{id}', { params: { path: { id } }, body })).data
      : unwrap(await api.POST('/governance/masking', { body })).data
  },
  async favorite(id: string, favorite: boolean) {
    return unwrap(
      await api.POST('/governance/catalog/{id}/favorite', {
        params: { path: { id } },
        body: { favorite },
      }),
    ).data
  },
}
