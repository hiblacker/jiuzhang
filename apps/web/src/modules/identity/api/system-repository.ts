import { api, unwrap } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export const systemRepository = {
  async demoUsers() {
    return unwrap(await api.GET('/session/users')).data
  },
  async session() {
    return unwrap(await api.GET('/session')).data
  },
  async users(query: Record<string, string> = {}) {
    return unwrap(await api.GET('/system/users', { params: { query } }))
  },
  async saveUser(body: Model<'UserInput'>, id?: string) {
    return id
      ? unwrap(await api.PATCH('/system/users/{id}', { params: { path: { id } }, body })).data
      : unwrap(await api.POST('/system/users', { body })).data
  },
  async roles() {
    return unwrap(await api.GET('/system/roles')).data
  },
  async saveRole(id: string, permissions: Model<'Role'>['permissions']) {
    return unwrap(
      await api.PATCH('/system/roles/{id}', { params: { path: { id } }, body: { permissions } }),
    ).data
  },
  async audit(query: Record<string, string> = {}) {
    return unwrap(await api.GET('/system/audit', { params: { query } }))
  },
  async settings() {
    return unwrap(await api.GET('/system/settings')).data
  },
  async saveSettings(body: Model<'Settings'>) {
    return unwrap(await api.PATCH('/system/settings', { body })).data
  },
}
