import { api, unwrap } from '@/shared/api/client'
export const overviewRepository = {
  async get(signal?: AbortSignal) {
    return unwrap(await api.GET('/overview', { signal })).data
  },
}
