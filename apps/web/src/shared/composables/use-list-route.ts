import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
export function useListRoute(scope = '') {
  const key = (name: string) => (scope ? scope + name[0]!.toUpperCase() + name.slice(1) : name)
  const route = useRoute(),
    router = useRouter()
  const filters = computed(() => {
    const page = queryValue('page')
    const pageSize = Number(queryValue('pageSize'))
    return {
      q: queryValue('q'),
      type: queryValue('type'),
      status: queryValue('status'),
      page: /^[1-9][0-9]*$/.test(page) && Number.isSafeInteger(Number(page)) ? Number(page) : 1,
      pageSize: [20, 50, 100].includes(pageSize) ? pageSize : 20,
      sort: queryValue('sort') === 'name' ? 'name' : 'updatedAt',
    }
  })
  function update(values: Record<string, string | number | null>) {
    const next = {
      ...route.query,
      ...Object.fromEntries(Object.entries(values).map(([name, value]) => [key(name), value])),
    }
    for (const [name, value] of Object.entries(next)) {
      if (
        value === '' ||
        value === null ||
        value === undefined ||
        (name === key('page') && value === 1)
      )
        delete next[name]
    }
    void router.push({ query: next })
  }
  function queryValue(name: string) {
    const value = route.query[key(name)]
    return typeof value === 'string' ? value : ''
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
            query: { ...route.query, [key('page')]: lastPage === 1 ? undefined : String(lastPage) },
          })
      },
      { immediate: true },
    )
  }
  return { filters, update, queryValue, bindPagination }
}
