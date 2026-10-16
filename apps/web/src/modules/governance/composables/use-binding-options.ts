import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useInfiniteQuery, useQueries } from '@tanstack/vue-query'
import { governanceRepository as repo } from '../api/governance-repository'

type BindingKind = 'quality' | 'masking'
type BindingPage =
  Awaited<ReturnType<typeof repo.quality>> | Awaited<ReturnType<typeof repo.masking>>

export function useBindingOptions(
  kind: MaybeRefOrGetter<BindingKind>,
  search: MaybeRefOrGetter<string>,
) {
  return useInfiniteQuery({
    queryKey: computed(() => ['governance', toValue(kind), 'binding-options', toValue(search)]),
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }): Promise<BindingPage> => {
      const filters = { q: toValue(search), page: String(pageParam), pageSize: '20', sort: 'name' }
      return toValue(kind) === 'quality'
        ? repo.quality(filters, signal)
        : repo.masking(filters, signal)
    },
    getNextPageParam: (lastPage) => {
      const { page = 1, pageSize = 20, total } = lastPage.meta
      if (total === undefined) return lastPage.data.length === pageSize ? page + 1 : undefined
      return page * pageSize < total ? page + 1 : undefined
    },
  })
}

export function useSelectedBindings(
  kind: MaybeRefOrGetter<BindingKind>,
  ids: MaybeRefOrGetter<string[]>,
) {
  return useQueries({
    queries: computed(() => {
      const currentKind = toValue(kind)
      return [...new Set(toValue(ids))].map((id) => ({
        queryKey: ['governance', currentKind, id],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          currentKind === 'quality' ? repo.qualityDetail(id, signal) : repo.maskDetail(id, signal),
      }))
    }),
  })
}
