import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/** URL owns shareable tabs; page-specific filters survive every selection. */
export function useRouteTab<T extends string>(allowed: readonly T[], fallback: T) {
  const route = useRoute(),
    router = useRouter()
  return computed<T>({
    get() {
      const value = route.query.tab
      return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
    },
    set(value) {
      if (!allowed.includes(value)) return
      void router.push({ query: { ...route.query, tab: value === fallback ? undefined : value } })
    },
  })
}
