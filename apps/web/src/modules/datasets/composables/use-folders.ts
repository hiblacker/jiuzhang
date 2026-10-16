import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { folderRepository } from '../api/folder-repository'

export function useFolders() {
  return useQuery({
    queryKey: ['dataset-folders'],
    queryFn: ({ signal }) => folderRepository.list(signal),
  })
}
export function useFolderActions() {
  const cache = useQueryClient()
  const done = () =>
    Promise.all(
      ['dataset-folders', 'datasets', 'governance', 'overview'].map((key) =>
        cache.invalidateQueries({ queryKey: [key] }),
      ),
    )
  return {
    save: useMutation({ mutationFn: folderRepository.save, onSuccess: done }),
    remove: useMutation({ mutationFn: folderRepository.remove, onSuccess: done }),
    move: useMutation({ mutationFn: folderRepository.move, onSuccess: done }),
  }
}
