import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { serviceRepository as repo } from '../api/service-repository'
import type { Model } from '@/shared/api/types'
export function useServiceAudit(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['services', 'audit', toValue(id)]),
    queryFn: () => repo.audit(toValue(id)),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useServices(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['services', 'list', toValue(filters)]),
    queryFn: () => repo.list(toValue(filters)),
  })
}
export function useService(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['services', 'detail', toValue(id)]),
    queryFn: () => repo.get(toValue(id)),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useServiceActions() {
  const cache = useQueryClient()
  const done = () => cache.invalidateQueries({ queryKey: ['services'] })
  return {
    save: useMutation({
      mutationFn: ({ body, id }: { body: Model<'ServiceInput'>; id?: string }) =>
        repo.save(body, id),
      onSuccess: done,
    }),
    updateMetadata: useMutation({
      mutationFn: ({
        id,
        body,
      }: {
        id: string
        body: Pick<
          Model<'ServiceInput'>,
          'name' | 'description' | 'owner' | 'tags' | 'pageSize' | 'allowedRoles'
        >
      }) => repo.patch(id, body),
      onSuccess: done,
    }),
    toggle: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => repo.toggle(id, enabled),
      onSuccess: done,
    }),
    call: useMutation({
      mutationFn: ({ id, parameters }: { id: string; parameters: Record<string, string> }) =>
        repo.call(id, parameters),
      onSuccess: done,
    }),
  }
}
