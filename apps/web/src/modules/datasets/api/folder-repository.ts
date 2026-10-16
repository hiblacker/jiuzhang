import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'

export const folderRepository = {
  async list(signal?: AbortSignal) {
    return unwrap(await api.GET('/dataset-folders', { signal })).data
  },
  async save({ id, body }: { id?: string; body: Model<'DatasetFolderInput'> }) {
    return id
      ? unwrap(await api.PATCH('/dataset-folders/{id}', { params: { path: { id } }, body })).data
      : unwrap(await api.POST('/dataset-folders', { body })).data
  },
  async remove(id: string) {
    return unwrap(await api.DELETE('/dataset-folders/{id}', { params: { path: { id } } })).data
  },
  async move({ id, folderId }: { id: string; folderId: string | null }) {
    return unwrap(
      await api.PATCH('/datasets/{id}', { params: { path: { id } }, body: { folderId } }),
    ).data
  },
}
