import type { Model } from '@/shared/api/types'

export function folderPath(folders: Model<'DatasetFolder'>[], id: string | null | undefined) {
  const names: string[] = []
  const visited = new Set<string>()
  let current = folders.find((folder) => folder.id === id)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    names.unshift(current.name)
    current = folders.find((folder) => folder.id === current!.parentId)
  }
  return names.join(' / ')
}
export function folderOptions(folders: Model<'DatasetFolder'>[], excludedId?: string) {
  const excluded = new Set(excludedId ? [excludedId] : [])
  let size = -1
  while (size !== excluded.size) {
    size = excluded.size
    for (const folder of folders) {
      if (folder.parentId && excluded.has(folder.parentId)) excluded.add(folder.id)
    }
  }
  return folders
    .filter((folder) => !excluded.has(folder.id))
    .map((folder) => ({ value: folder.id, label: folderPath(folders, folder.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
