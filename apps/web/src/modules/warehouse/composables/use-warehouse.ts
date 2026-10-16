import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { warehouseRepository as repo } from '../api/warehouse-repository'
export function useSubjectDomains() {
  return useQuery({
    queryKey: ['warehouse', 'subject-domains'],
    queryFn: ({ signal }) => repo.subjectDomains(signal),
  })
}
export function useWarehouseMetrics(id: MaybeRefOrGetter<string> = '') {
  return useQuery({
    queryKey: computed(() => ['warehouse', 'metrics', toValue(id)]),
    queryFn: () => repo.metrics(toValue(id)),
  })
}
export function useTables(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['warehouse', 'tables', toValue(filters)]),
    queryFn: () => repo.tables(toValue(filters)),
  })
}
export function useTable(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['warehouse', 'table', toValue(id)]),
    queryFn: () => repo.table(toValue(id)),
  })
}
export function useQueries(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['warehouse', 'queries', toValue(filters)]),
    queryFn: ({ signal }) => repo.queries(toValue(filters), signal),
  })
}
export function useQueryResult(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['warehouse', 'query', toValue(id)]),
    queryFn: () => repo.queryDetail(toValue(id)),
    enabled: computed(() => !!toValue(id)),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 500 : false),
  })
}
export function useImports(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['warehouse', 'imports', toValue(filters)]),
    queryFn: ({ signal }) => repo.imports(toValue(filters), signal),
    refetchInterval: (query) =>
      query.state.data?.data.some((task) => ['queued', 'running'].includes(task.status))
        ? 500
        : false,
  })
}

export function useExports(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['warehouse', 'exports', toValue(filters)]),
    queryFn: ({ signal }) => repo.exports(toValue(filters), signal),
    refetchInterval: (query) =>
      query.state.data?.data.some((task) => task.status === 'preparing') ? 500 : false,
  })
}

export function useWarehouseActions() {
  const cache = useQueryClient()
  const done = async () => {
    await cache.invalidateQueries({ queryKey: ['warehouse'] })
    await cache.invalidateQueries({ queryKey: ['overview'] })
  }
  return {
    query: useMutation({ mutationFn: repo.query, onSuccess: done }),
    cancelQuery: useMutation({ mutationFn: repo.cancelQuery, onSuccess: done }),
    import: useMutation({ mutationFn: repo.import, onSuccess: done }),
    export: useMutation({ mutationFn: repo.export, onSuccess: done }),
    download: useMutation({
      mutationFn: repo.exportDetail,
      onSuccess: (record) =>
        cache.setQueriesData<Awaited<ReturnType<typeof repo.exports>>>(
          { queryKey: ['warehouse', 'exports'] },
          (items) =>
            items
              ? {
                  ...items,
                  data: items.data.map((item) => (item.id === record.id ? record : item)),
                }
              : items,
        ),
    }),
  }
}
