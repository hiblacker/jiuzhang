import type { Model } from '@/shared/api/types'

export function folderScope(folders: Model<'DatasetFolder'>[], id: string) {
  const ids = new Set([id])
  let size = 0
  while (size !== ids.size) {
    size = ids.size
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId)) ids.add(folder.id)
    }
  }
  return ids
}
