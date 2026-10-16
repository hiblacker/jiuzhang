import { computed, inject, type ComputedRef, type InjectionKey } from 'vue'
export const permissionsKey: InjectionKey<ComputedRef<readonly string[]>> = Symbol('permissions')
export function useCan(permission: string) {
  const permissions = inject(
    permissionsKey,
    computed(() => []),
  )
  return computed(() => permissions.value.includes(permission))
}
