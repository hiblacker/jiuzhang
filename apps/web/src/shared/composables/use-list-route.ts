import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
export function useListRoute() {
  const route = useRoute(),
    router = useRouter()
  const filters = computed(() => ({
    q: typeof route.query.q === 'string' ? route.query.q : '',
    type: typeof route.query.type === 'string' ? route.query.type : '',
    status: typeof route.query.status === 'string' ? route.query.status : '',
    page:
      typeof route.query.page === 'string' &&
      /^[1-9][0-9]*$/.test(route.query.page) &&
      Number.isSafeInteger(Number(route.query.page))
        ? Number(route.query.page)
        : 1,
    pageSize: [20, 50, 100].includes(Number(route.query.pageSize))
      ? Number(route.query.pageSize)
      : 20,
    sort: route.query.sort === 'name' ? 'name' : 'updatedAt',
  }))
  function update(values: Record<string, string | number | null>) {
    const next = { ...route.query, ...values }
    for (const [key, value] of Object.entries(next)) {
      if (value === '' || value === null || value === undefined || (key === 'page' && value === 1))
        delete next[key]
    }
    void router.push({ query: next })
  }
  function queryValue(key: string) {
    return typeof route.query[key] === 'string' ? route.query[key] : ''
  }
  function bindPagination(
    meta: () => { total?: number; page?: number; pageSize?: number } | undefined,
  ) {
    watch(
      [meta, () => filters.value.page, () => filters.value.pageSize],
      ([value, page, size]) => {
        if (!value || value.total === undefined || value.page !== page || value.pageSize !== size)
          return
        const lastPage = Math.max(1, Math.ceil(value.total / size))
        if (page > lastPage)
          void router.replace({
            query: { ...route.query, page: lastPage === 1 ? undefined : String(lastPage) },
          })
      },
      { immediate: true },
    )
  }
  return { filters, update, queryValue, bindPagination }
}
