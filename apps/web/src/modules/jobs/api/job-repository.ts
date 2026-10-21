import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export const jobRepository = {
  async tasks(query: Record<string, string> = {}, signal?: AbortSignal) {
    return unwrap(await api.GET('/tasks', { params: { query }, signal }))
  },
  async task(id: string, signal?: AbortSignal) {
    return unwrap(await api.GET('/tasks/{id}', { params: { path: { id } }, signal })).data
  },
  async save(id: string, body: Model<'TaskInput'>) {
    return unwrap(await api.PATCH('/tasks/{id}', { params: { path: { id } }, body })).data
  },
  async toggle(id: string, enabled: boolean) {
    return enabled
      ? unwrap(await api.POST('/tasks/{id}/resume', { params: { path: { id } } })).data
      : unwrap(await api.POST('/tasks/{id}/pause', { params: { path: { id } } })).data
  },
  async run(datasetId: string, allowEmptySnapshot = false, key?: string) {
    return unwrap(
      await api.POST('/datasets/{id}/runs', {
        params: { path: { id: datasetId } },
        body: { allowEmptySnapshot },
        headers: key ? { 'Idempotency-Key': key } : undefined,
      }),
    ).data
  },
  async runs(query: Record<string, string> = {}, signal?: AbortSignal) {
    return unwrap(await api.GET('/runs', { params: { query }, signal }))
  },
  async detail(id: string) {
    return unwrap(await api.GET('/runs/{id}', { params: { path: { id } } })).data
  },
  async cancel(id: string) {
    return unwrap(await api.POST('/runs/{id}/cancel', { params: { path: { id } } })).data
  },
  async retry(id: string, allowEmptySnapshot = false, key?: string) {
    return unwrap(
      await api.POST('/runs/{id}/retry', {
        params: { path: { id } },
        body: { allowEmptySnapshot },
        headers: key ? { 'Idempotency-Key': key } : undefined,
      }),
    ).data
  },
  async backfill(id: string, body: Model<'BackfillInput'>) {
    return unwrap(await api.POST('/tasks/{id}/backfills', { params: { path: { id } }, body })).data
  },
}
