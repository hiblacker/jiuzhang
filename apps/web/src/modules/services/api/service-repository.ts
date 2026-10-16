import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export const serviceRepository = {
  async audit(id: string) {
    return unwrap(
      await api.GET('/services/{id}/audit', {
        params: { path: { id }, query: { pageSize: '100' } },
      }),
    ).data
  },
  async list(query: Record<string, string> = {}) {
    return unwrap(await api.GET('/services', { params: { query } }))
  },
  async get(id: string) {
    return unwrap(await api.GET('/services/{id}', { params: { path: { id } } })).data
  },
  async save(body: Model<'ServiceInput'>, id?: string) {
    return id
      ? unwrap(await api.PATCH('/services/{id}', { params: { path: { id } }, body })).data
      : unwrap(await api.POST('/services', { body })).data
  },
  async patch(id: string, body: Model<'ServiceInputPatch'>) {
    return unwrap(await api.PATCH('/services/{id}', { params: { path: { id } }, body })).data
  },
  async toggle(id: string, enabled: boolean) {
    return enabled
      ? unwrap(await api.POST('/services/{id}/enable', { params: { path: { id } } })).data
      : unwrap(await api.POST('/services/{id}/disable', { params: { path: { id } } })).data
  },
  async call(id: string, parameters: Record<string, string>) {
    return unwrap(
      await api.POST('/services/{id}/call', { params: { path: { id } }, body: { parameters } }),
    ).data
  },
}
