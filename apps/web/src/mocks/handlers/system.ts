import type { Model } from '@/shared/api/types'
import { nextId } from '../db'
import { route, find, ensure } from './core'
export const systemHandlers = [
  route(
    'post',
    '/auth/login',
    ({ state, body }) => {
      const input = body as Model<'LoginInput'>
      const user = state.users.find(
        (entry) => entry.enabled && (entry.username ?? entry.id) === input.username,
      )
      ensure(user, 401, 'INVALID_CREDENTIALS', '演示账号不存在')
      return { role: user.role, user, permissions: find(state.roles, user.role).permissions }
    },
    { input: 'LoginInput', readAction: true },
  ),
  route('post', '/auth/logout', () => ({ message: 'OK' }), { readAction: true }),
  route(
    'post',
    '/auth/password',
    () => {
      ensure(false, 501, 'NOT_IMPLEMENTED', '演示环境不保存真实密码')
    },
    { input: 'PasswordChangeInput', readAction: true },
  ),
  route('get', '/session/users', ({ state }) => state.users),
  route('get', '/session', ({ state, role, request }) => ({
    role,
    user: request.headers.has('x-demo-user')
      ? find(state.users, request.headers.get('x-demo-user'))
      : state.users.find((user) => user.enabled && user.role === role)!,
    permissions: find(state.roles, role).permissions,
  })),
  route('get', '/system/users', ({ state }) => state.users, { list: true, admin: true }),
  route('get', '/system/users/{id}', ({ state, params }) => find(state.users, params.id), {
    admin: true,
  }),
  route(
    'post',
    '/system/users',
    ({ state, body, now }) => {
      const input = body as Model<'UserInput'>
      ensure(!('password' in input), 422, 'VALIDATION_ERROR', '演示环境不保存真实密码')
      ensure(input.name.trim(), 422, 'VALIDATION_ERROR', '名称必填')
      const user = { ...input, id: nextId(state), updatedAt: now }
      state.users.push(user)
      return user
    },
    { input: 'UserInput', created: true, admin: true },
  ),
  route(
    'patch',
    '/system/users/{id}',
    ({ state, params, body, now, request }) => {
      const user = find(state.users, params.id)
      ensure(!('password' in (body as object)), 422, 'VALIDATION_ERROR', '演示环境不保存真实密码')
      const input = { ...user, ...(body as Model<'UserInputPatch'>) }
      ensure(input.name.trim(), 422, 'VALIDATION_ERROR', '用户名称不能为空')
      const acting =
        request.headers.get('x-demo-user') ||
        state.users.find((entry) => entry.enabled && entry.role === 'admin')?.id
      ensure(
        user.id !== acting || (input.enabled && input.role === 'admin'),
        409,
        'STATE_CONFLICT',
        '不能停用或降低当前演示管理员的权限',
      )
      Object.assign(user, input, { updatedAt: now })
      return user
    },
    { input: 'UserInput', admin: true },
  ),
  route(
    'delete',
    '/system/users/{id}',
    ({ state, params, request }) => {
      const user = find(state.users, params.id)
      const acting =
        request.headers.get('x-demo-user') ||
        state.users.find((entry) => entry.enabled && entry.role === 'admin')?.id
      ensure(user.id !== acting, 409, 'STATE_CONFLICT', '不能删除当前演示管理员')
      state.users = state.users.filter((u) => u.id !== params.id)
      return { message: '已删除' }
    },
    { admin: true },
  ),
  route('get', '/system/roles', ({ state }) => state.roles, { admin: true }),
  route(
    'patch',
    '/system/roles/{id}',
    ({ state, params, body }) => {
      const role = find(state.roles, params.id)
      ensure(role.id !== 'admin', 409, 'STATE_CONFLICT', '演示管理员固定保留管理权限')
      role.permissions = (body as Pick<Model<'Role'>, 'permissions'>).permissions
      return role
    },
    { admin: true },
  ),
  route('get', '/system/audit', ({ state }) => state.audit, { list: true, admin: true }),
  route('get', '/system/settings', ({ state }) => state.settings),
  route(
    'patch',
    '/system/settings',
    ({ state, body }) => {
      const next = { ...state.settings, ...(body as Model<'SettingsPatch'>) }
      try {
        new Intl.DateTimeFormat('zh-CN', { timeZone: next.timezone })
      } catch {
        ensure(false, 422, 'VALIDATION_ERROR', '无效时区')
      }
      state.settings = next
      return state.settings
    },
    { input: 'Settings' },
  ),
]
