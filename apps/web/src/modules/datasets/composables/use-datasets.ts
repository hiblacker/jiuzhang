import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { datasetRepository } from '../api/dataset-repository'
import { newDataset, toInput } from '../model/definition'
import { useDatasetDraftPreview } from './use-dataset-draft-preview'
export function useDatasets(filters: MaybeRefOrGetter<Record<string, string>>) {
  return useQuery({
    queryKey: computed(() => ['datasets', toValue(filters)]),
    queryFn: ({ signal }) => datasetRepository.list(toValue(filters), signal),
  })
}
export function useDataset(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['datasets', 'detail', toValue(id)]),
    queryFn: ({ signal }) => datasetRepository.get(toValue(id), signal),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useDatasetVersions(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['datasets', 'versions', toValue(id)]),
    queryFn: () => datasetRepository.versions(toValue(id)),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useDatasetPreview(
  id: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean>,
  direct: MaybeRefOrGetter<boolean> = false,
) {
  return useQuery({
    queryKey: computed(() => [
      'datasets',
      toValue(direct) ? 'direct-query' : 'preview',
      toValue(id),
    ]),
    queryFn: () =>
      toValue(direct)
        ? datasetRepository.query(toValue(id))
        : datasetRepository.previewSaved(toValue(id)),
    enabled: computed(() => !!toValue(id) && toValue(enabled)),
  })
}
export function useDatasetVersion(id: MaybeRefOrGetter<string>, version: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['datasets', 'version', toValue(id), toValue(version)]),
    queryFn: ({ signal }) => datasetRepository.version(toValue(id), toValue(version), signal),
    enabled: computed(() => !!toValue(id) && !!toValue(version)),
  })
}
export function useDatasetActions() {
  const cache = useQueryClient()
  const done = async () => {
    await Promise.all(
      ['datasets', 'tasks', 'overview'].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    )
  }
  return {
    remove: useMutation({ mutationFn: datasetRepository.remove, onSuccess: done }),
    publish: useMutation({ mutationFn: datasetRepository.publish, onSuccess: done }),
    restore: useMutation({
      mutationFn: ({ id, version }: { id: string; version: string }) =>
        datasetRepository.restore(id, version),
      onSuccess: done,
    }),
  }
}
export function useDatasetEditor(id: MaybeRefOrGetter<string>) {
  const query = useDataset(id),
    draft = ref(newDataset()),
    baseline = ref(JSON.stringify(draft.value))
  const cache = useQueryClient()
  let loaded = ''
  const preview = useDatasetDraftPreview(draft, id)
  watch(
    () => query.data.value,
    (data) => {
      if (data && data.id !== loaded) {
        draft.value = toInput(data)
        baseline.value = JSON.stringify(draft.value)
        loaded = data.id
        preview.acceptDefinition()
      }
    },
    { immediate: true },
  )
  const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value)
  watch(
    () => toValue(id),
    (value) => {
      if (!value) {
        draft.value = newDataset()
        baseline.value = JSON.stringify(draft.value)
        loaded = ''
      }
    },
  )
  const save = useMutation({
    mutationFn: () => datasetRepository.save(toInput(draft.value), toValue(id) || undefined),
    onSuccess: async (saved) => {
      draft.value = toInput(saved)
      baseline.value = JSON.stringify(draft.value)
      preview.acceptDefinition()
      await cache.invalidateQueries({ queryKey: ['datasets'] })
      await cache.invalidateQueries({ queryKey: ['overview'] })
    },
  })
  function reset() {
    if (!query.data.value) return
    draft.value = toInput(query.data.value)
    baseline.value = JSON.stringify(draft.value)
    preview.acceptDefinition()
  }
  return { query, draft, dirty, save, preview, reset }
}
