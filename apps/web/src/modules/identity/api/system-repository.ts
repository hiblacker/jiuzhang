import { api, unwrap, setCsrfToken } from '@/shared/api/client'
import type { Model } from '@/shared/api/types'
export const systemRepository = {
  async demoUsers() {
    return unwrap(await api.GET('/session/users')).data
  },
  async session() {
    const session = unwrap(await api.GET('/session')).data
    setCsrfToken(session.csrfToken ?? '')
    return session
  },
  async login(body: Model<'LoginInput'>) {
    const session = unwrap(await api.POST('/auth/login', { body })).data
    setCsrfToken(session.csrfToken ?? '')
    return session
  },
  async logout() {
    unwrap(await api.POST('/auth/logout'))
    setCsrfToken('')
  },
  async changePassword(body: Model<'PasswordChangeInput'>) {
    unwrap(await api.POST('/auth/password', { body }))
    setCsrfToken('')
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
