import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { sourceRepository, type SourceFilters } from '../api/source-repository'
import { newSource, toSourceInput } from '../model/connectors'
import { compareSourceConfiguration } from '../model/configuration-diff'
import { ApiError } from '@/shared/api/client'
export function useSources(filters: MaybeRefOrGetter<SourceFilters>) {
  return useQuery({
    queryKey: computed(() => ['sources', toValue(filters)]),
    queryFn: ({ signal }) => sourceRepository.list(toValue(filters), signal),
  })
}
export function useSourceOptions(search: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['sources', 'options', toValue(search)]),
    queryFn: ({ signal }) =>
      sourceRepository.list(
        { q: toValue(search), type: '', status: '', page: 1, pageSize: 20, sort: 'name' },
        signal,
      ),
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
  const credentials = ref({ username: '', password: '' })
  const savedUsername = ref('')
  function input() {
    const value = toSourceInput(draft.value)
    if (
      !credentials.value.password &&
      (!toValue(id) || credentials.value.username !== savedUsername.value)
    )
      throw new ApiError('SOURCE_CREDENTIALS_REQUIRED', 422, '')
    if (credentials.value.password) value.credentials = { ...credentials.value }
    return value
  }
  watch(
    () => query.data.value,
    (source) => {
      if (source && source.id !== loadedId.value) {
        draft.value = toSourceInput(source)
        baseline.value = toSourceInput(source)
        loadedId.value = source.id
        savedUsername.value = source.connectionUsername ?? ''
        credentials.value = { username: savedUsername.value, password: '' }
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
  const dirty = computed(
    () =>
      JSON.stringify(draft.value) !== JSON.stringify(baseline.value) ||
      !!credentials.value.password ||
      credentials.value.username !== savedUsername.value,
  )
  const changes = computed(() =>
    toValue(id) && loadedId.value === toValue(id)
      ? compareSourceConfiguration(baseline.value, draft.value)
      : [],
  )
  const save = useMutation({
    mutationFn: () => sourceRepository.save(input(), toValue(id) || undefined),
    onSuccess: async (source) => {
      draft.value = toSourceInput(source)
      baseline.value = toSourceInput(source)
      credentials.value.password = ''
      savedUsername.value = source.connectionUsername ?? ''
      credentials.value.username = savedUsername.value
      await cache.invalidateQueries({ queryKey: ['sources'] })
      await cache.invalidateQueries({ queryKey: ['overview'] })
    },
  })
  const test = useMutation({
    mutationFn: () => sourceRepository.test(input(), toValue(id) || undefined),
  })
  watch(
    [draft, credentials],
    () => {
      if (!test.isPending.value) test.reset()
      if (!save.isPending.value) save.reset()
    },
    { deep: true },
  )
  return { query, draft, credentials, dirty, changes, save, test }
}
