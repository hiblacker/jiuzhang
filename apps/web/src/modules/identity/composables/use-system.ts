import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { systemRepository as repo } from '../api/system-repository'
import type { Model } from '@/shared/api/types'
export function sessionOptions() {
  return { queryKey: ['identity', 'session'], queryFn: repo.session }
}
export function useSession() {
  return useQuery(sessionOptions())
}
export function useUsers(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['system', 'users', toValue(filters)]),
    queryFn: () => repo.users(toValue(filters)),
  })
}
export function useAuthentication() {
  return {
    login: useMutation({ mutationFn: repo.login }),
    logout: useMutation({ mutationFn: repo.logout }),
    password: useMutation({ mutationFn: repo.changePassword }),
  }
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
