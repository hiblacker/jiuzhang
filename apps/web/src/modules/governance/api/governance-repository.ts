import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export const governanceRepository = {
  async quality(query: Record<string, string> = {}) {
    return unwrap(await api.GET('/governance/quality', { params: { query } }))
  },
  async masking(query: Record<string, string> = {}) {
    return unwrap(await api.GET('/governance/masking', { params: { query } }))
  },
  async catalog(query: Record<string, string> = {}) {
    return unwrap(await api.GET('/governance/catalog', { params: { query } }))
  },
  async lineage(scope: 'resource' | 'field' = 'resource') {
    return unwrap(await api.GET('/governance/lineage', { params: { query: { scope } } })).data
  },
  async qualityDetail(id: string) {
    return unwrap(await api.GET('/governance/quality/{id}', { params: { path: { id } } })).data
  },
  async maskDetail(id: string) {
    return unwrap(await api.GET('/governance/masking/{id}', { params: { path: { id } } })).data
  },
  async maskPreview(id: string, sample: 'phone' | 'email' | 'text' | 'amount') {
    return unwrap(
      await api.POST('/governance/masking/{id}/preview', {
        params: { path: { id } },
        body: { sample },
      }),
    ).data
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
  async evaluate(id: string, scenario: 'pass' | 'warn' | 'block') {
    return unwrap(
      await api.POST('/governance/quality/{id}/evaluate', {
        params: { path: { id } },
        body: { scenario },
      }),
    ).data
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
