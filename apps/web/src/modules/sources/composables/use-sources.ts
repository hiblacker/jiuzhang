import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { sourceRepository, type SourceFilters } from '../api/source-repository'
import { newSource, toSourceInput } from '../model/connectors'
import { compareSourceConfiguration } from '../model/configuration-diff'
export function useSources(filters: MaybeRefOrGetter<SourceFilters>) {
  return useQuery({
    queryKey: computed(() => ['sources', toValue(filters)]),
    queryFn: ({ signal }) => sourceRepository.list(toValue(filters), signal),
  })
}
export function useSourceOptions(search: MaybeRefOrGetter<string>) {
  return useInfiniteQuery({
    queryKey: computed(() => ['sources', 'options', toValue(search)]),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      sourceRepository.list(
        { q: toValue(search), type: '', status: '', page: pageParam, pageSize: 20, sort: 'name' },
        signal,
      ),
    getNextPageParam: (lastPage) => {
      const { page = 1, pageSize = 20, total } = lastPage.meta
      if (total === undefined) return lastPage.data.length === pageSize ? page + 1 : undefined
      return page * pageSize < total ? page + 1 : undefined
    },
  })
}
export function useSource(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['sources', 'detail', toValue(id)]),
    queryFn: ({ signal }) => sourceRepository.get(toValue(id), signal),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useSourceObjects(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['sources', 'objects', toValue(id)]),
    queryFn: ({ signal }) => sourceRepository.objects(toValue(id), signal),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useSourcePreview(id: MaybeRefOrGetter<string>, objectId: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['sources', 'preview', toValue(id), toValue(objectId)]),
    queryFn: () => sourceRepository.preview(toValue(id), toValue(objectId)),
    enabled: computed(() => !!toValue(id) && !!toValue(objectId)),
  })
}
export function useDeleteSource() {
  const cache = useQueryClient()
  return useMutation({
    mutationFn: sourceRepository.remove,
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['sources'] })
      await cache.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}
export function useSourceEditor(id: MaybeRefOrGetter<string>) {
  const query = useSource(id)
  const draft = ref(newSource())
  const baseline = ref(toSourceInput(draft.value))
  const loadedId = ref('')
  const cache = useQueryClient()
  watch(
    () => query.data.value,
    (source) => {
      if (source && source.id !== loadedId.value) {
        draft.value = toSourceInput(source)
        baseline.value = toSourceInput(source)
        loadedId.value = source.id
      }
    },
    { immediate: true },
  )
  watch(
    () => toValue(id),
    (value) => {
      if (!value) {
        draft.value = newSource()
        baseline.value = toSourceInput(draft.value)
        loadedId.value = ''
      }
    },
  )
  const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(baseline.value))
  const changes = computed(() =>
    toValue(id) && loadedId.value === toValue(id)
      ? compareSourceConfiguration(baseline.value, draft.value)
      : [],
  )
  const save = useMutation({
    mutationFn: () => sourceRepository.save(toSourceInput(draft.value), toValue(id) || undefined),
    onSuccess: async (source) => {
      draft.value = toSourceInput(source)
      baseline.value = toSourceInput(source)
      await cache.invalidateQueries({ queryKey: ['sources'] })
      await cache.invalidateQueries({ queryKey: ['overview'] })
    },
  })
  const test = useMutation({ mutationFn: () => sourceRepository.test(toSourceInput(draft.value)) })
  watch(
    draft,
    () => {
      if (!test.isPending.value) test.reset()
      if (!save.isPending.value) save.reset()
    },
    { deep: true },
  )
  return { query, draft, dirty, changes, save, test }
}
