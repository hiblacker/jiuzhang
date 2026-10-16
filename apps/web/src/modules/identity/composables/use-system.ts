import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { systemRepository as repo } from '../api/system-repository'
import type { Model } from '@/shared/api/types'
export function sessionOptions(role: string, userId = '') {
  return { queryKey: ['identity', 'session', role, userId], queryFn: repo.session }
}
export function useSession(role: MaybeRefOrGetter<string>, userId: MaybeRefOrGetter<string> = '') {
  return useQuery(computed(() => sessionOptions(toValue(role), toValue(userId))))
}
export function useUsers(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['system', 'users', toValue(filters)]),
    queryFn: () => repo.users(toValue(filters)),
  })
}
export function useDemoUsers() {
  return useQuery({ queryKey: ['identity', 'demoUsers'], queryFn: repo.demoUsers })
}
export function useRoles() {
  return useQuery({ queryKey: ['system', 'roles'], queryFn: repo.roles })
}
export function useAudit(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['system', 'audit', toValue(filters)]),
    queryFn: () => repo.audit(toValue(filters)),
  })
}
export function useSettings() {
  return useQuery({ queryKey: ['system', 'settings'], queryFn: repo.settings })
}
export function useSystemActions() {
  const cache = useQueryClient()
  const done = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ['system'] }),
      cache.invalidateQueries({ queryKey: ['identity'] }),
    ])
  return {
    user: useMutation({
      mutationFn: ({ body, id }: { body: Model<'UserInput'>; id?: string }) =>
        repo.saveUser(body, id),
      onSuccess: done,
    }),
    role: useMutation({
      mutationFn: ({
        id,
        permissions,
      }: {
        id: string
        permissions: Model<'Role'>['permissions']
      }) => repo.saveRole(id, permissions),
      onSuccess: async () => {
        await done()
        await Promise.all(
          ['warehouse', 'services'].map((key) => cache.invalidateQueries({ queryKey: [key] })),
        )
      },
    }),
    settings: useMutation({ mutationFn: repo.saveSettings, onSuccess: done }),
  }
}
