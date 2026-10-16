import type { Model } from '@/shared/api/types'
import { nextId } from '../db'
import type { MockState } from '../fixtures/seed'
import { folderScope } from '../model/folders'
import { route, ensure, find } from './core'

function checkFolder(state: MockState, input: Model<'DatasetFolderInput'>, id?: string) {
  ensure(input.name.trim(), 422, 'VALIDATION_ERROR', '目录名称不能为空')
  if (input.parentId) find(state.folders, input.parentId)
  ensure(
    !id || !input.parentId || !folderScope(state.folders, id).has(input.parentId),
    422,
    'VALIDATION_ERROR',
    '目录不能移入自己或子目录',
  )
  ensure(
    !state.folders.some(
      (folder) =>
        folder.id !== id && folder.parentId === input.parentId && folder.name === input.name.trim(),
    ),
    409,
    'DUPLICATE_NAME',
    '同一父目录下名称已存在',
  )
}
export const folderHandlers = [
  route('get', '/dataset-folders', ({ state }) => state.folders),
  route(
    'post',
    '/dataset-folders',
    ({ state, body, now }) => {
      const input = body as Model<'DatasetFolderInput'>
      checkFolder(state, input)
      const folder: Model<'DatasetFolder'> = {
        ...input,
        name: input.name.trim(),
        id: nextId(state),
        updatedAt: now,
      }
      state.folders.push(folder)
      return folder
    },
    { input: 'DatasetFolderInput', created: true },
  ),
  route(
    'patch',
    '/dataset-folders/{id}',
    ({ state, params, body, now }) => {
      const folder = find(state.folders, params.id)
      const input = { ...folder, ...(body as Model<'DatasetFolderInputPatch'>) }
      checkFolder(state, input, folder.id)
      Object.assign(folder, input, { name: input.name.trim(), updatedAt: now })
      return folder
    },
    { input: 'DatasetFolderInput' },
  ),
  route('delete', '/dataset-folders/{id}', ({ state, params }) => {
    const folder = find(state.folders, params.id)
    ensure(
      !state.folders.some((entry) => entry.parentId === folder.id) &&
        !state.datasets.some((dataset) => dataset.folderId === folder.id),
      409,
      'DEPENDENCY_CONFLICT',
      '请先移动数据集和子目录，再删除空目录',
    )
    state.folders = state.folders.filter((entry) => entry.id !== folder.id)
    return { id: folder.id }
  }),
]
