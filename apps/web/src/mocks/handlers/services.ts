import type { Model } from '@/shared/api/types'
import { nextId } from '../db'
import { route, find, ensure, audit } from './core'
import type { MockState } from '../fixtures/seed'
import { visibleFields } from '../model/data-access'
function allowedColumns(state: MockState, role: string, tableId: string) {
  return new Set(
    visibleFields(state, role, find(state.tables, tableId).fields).map((field) => field.target),
  )
}
function visibleService(
  state: MockState,
  role: string,
  service: Model<'Service'>,
): Model<'Service'> {
  const allowed = allowedColumns(state, role, service.tableId)
  const fields = service.fields.filter((field) => allowed.has(field))
  const parameters = service.parameters.filter((parameter) => allowed.has(parameter.name))
  const sortField = allowed.has(service.sortField) ? service.sortField : ''
  return {
    ...service,
    fields,
    parameters,
    sortField,
    definitionRestricted:
      fields.length !== service.fields.length ||
      parameters.length !== service.parameters.length ||
      sortField !== service.sortField,
  }
}
function requireServiceAccess(service: Model<'Service'>, role: string) {
  ensure(
    service.allowedRoles.some((allowed) => allowed === role),
    403,
    'FORBIDDEN',
    '当前角色不在服务范围内',
  )
}
function requireDefinitionAccess(state: MockState, role: string, input: Model<'ServiceInput'>) {
  const allowed = allowedColumns(state, role, input.tableId)
  ensure(
    input.fields.every((field) => allowed.has(field)) &&
      input.parameters.every((parameter) => allowed.has(parameter.name)) &&
      (!input.sortField || allowed.has(input.sortField)),
    403,
    'FORBIDDEN',
    '当前角色不能配置不可见字段',
  )
}
function validateService(state: MockState, input: Model<'ServiceInput'>, id = '') {
  const table = find(state.tables, input.tableId)
  const fields = table.fields.filter((field) => field.output).map((field) => field.target)
  ensure(
    input.name.trim() &&
      input.fields.length &&
      new Set(input.fields).size === input.fields.length &&
      input.fields.every((field) => fields.includes(field)),
    422,
    'VALIDATION_ERROR',
    '名称与输出字段必须有效且不重复',
  )
  ensure(
    !state.services.some((service) => service.id !== id && service.name === input.name),
    409,
    'DUPLICATE_NAME',
    '服务名称已存在',
  )
  ensure(
    Number.isInteger(input.pageSize) && input.pageSize >= 1 && input.pageSize <= 100,
    422,
    'VALIDATION_ERROR',
    '分页大小须为 1 至 100',
  )
  ensure(
    !input.sortField || fields.includes(input.sortField),
    422,
    'VALIDATION_ERROR',
    '排序字段不存在',
  )
  ensure(
    input.allowedRoles.length > 0 &&
      input.allowedRoles.every((role) => state.roles.some((entry) => entry.id === role)),
    422,
    'VALIDATION_ERROR',
    '请选择有效访问角色',
  )
  ensure(
    new Set(input.parameters.map((parameter) => parameter.name)).size === input.parameters.length &&
      input.parameters.every(
        (parameter) =>
          fields.includes(parameter.name) && ['string', 'number'].includes(parameter.type),
      ),
    422,
    'VALIDATION_ERROR',
    '参数须对应源字段且不能重名',
  )
}
export const serviceHandlers = [
  route(
    'get',
    '/services',
    ({ state, role }) =>
      state.services
        .filter((service) => service.allowedRoles.some((allowed) => allowed === role))
        .map((service) => visibleService(state, role, service)),
    { list: true },
  ),
  route('get', '/services/{id}', ({ state, params, role }) => {
    const service = find(state.services, params.id)
    ensure(
      service.allowedRoles.includes(role as 'admin'),
      403,
      'FORBIDDEN',
      '当前角色不在服务范围内',
    )
    return visibleService(state, role, service)
  }),
  route(
    'get',
    '/services/{id}/audit',
    ({ state, params, role }) => {
      const service = find(state.services, params.id)
      ensure(
        service.allowedRoles.includes(role as 'admin'),
        403,
        'FORBIDDEN',
        '当前角色不在服务范围内',
      )
      return state.audit.filter(
        (entry) => entry.resource === 'services' && entry.resourceId === service.id,
      )
    },
    { list: true },
  ),
  route(
    'post',
    '/services',
    ({ state, body, now, role }) => {
      const input = body as Model<'ServiceInput'>
      validateService(state, input)
      requireDefinitionAccess(state, role, input)
      const service: Model<'Service'> = {
        ...input,
        id: nextId(state),
        updatedAt: now,
        enabled: true,
        callCount: 0,
      }
      state.services.unshift(service)
      return visibleService(state, role, service)
    },
    { input: 'ServiceInput', created: true },
  ),
  route(
    'patch',
    '/services/{id}',
    ({ state, params, body, now, role }) => {
      const service = find(state.services, params.id)
      requireServiceAccess(service, role)
      const patch = body as Model<'ServiceInputPatch'>
      const changesDefinition = ['tableId', 'fields', 'parameters', 'sortField'].some((field) =>
        Object.hasOwn(patch, field),
      )
      ensure(
        !changesDefinition || !visibleService(state, role, service).definitionRestricted,
        403,
        'FORBIDDEN',
        '当前角色不能替换含不可见字段的服务定义；可单独修改元数据',
      )
      const input = { ...service, ...patch }
      validateService(state, input, service.id)
      if (changesDefinition) requireDefinitionAccess(state, role, input)
      Object.assign(service, input, { updatedAt: now })
      return visibleService(state, role, service)
    },
    { input: 'ServiceInput' },
  ),
  route('delete', '/services/{id}', ({ state, params, role }) => {
    requireServiceAccess(find(state.services, params.id), role)
    state.services = state.services.filter((s) => s.id !== params.id)
    return { message: '已删除' }
  }),
  ...(['enable', 'disable'] as const).map((action) =>
    route('post', '/services/{id}/' + action, ({ state, params, role }) => {
      const service = find(state.services, params.id)
      requireServiceAccess(service, role)
      service.enabled = action === 'enable'
      return visibleService(state, role, service)
    }),
  ),
  route(
    'post',
    '/services/{id}/call',
    ({ state, params, body, role, userId }) => {
      const service = find(state.services, params.id)
      ensure(service.enabled, 409, 'SERVICE_DISABLED', '服务已停用')
      ensure(
        service.allowedRoles.includes(role as 'admin'),
        403,
        'FORBIDDEN',
        '当前角色不在服务范围内',
      )
      const input = (body as Model<'ServiceCall'>).parameters
      const allowed = allowedColumns(state, role, service.tableId)
      ensure(
        Object.keys(input).every((key) => service.parameters.some((p) => p.name === key)),
        400,
        'INVALID_PARAMETER',
        '参数未在契约定义',
      )
      ensure(
        Object.keys(input).every((field) => allowed.has(field)) &&
          (!service.sortField || allowed.has(service.sortField)) &&
          service.parameters.every(
            (parameter) => !parameter.required || allowed.has(parameter.name),
          ),
        403,
        'FORBIDDEN',
        '当前调用依赖不可见字段',
      )
      for (const p of service.parameters) {
        if (input[p.name] !== undefined)
          ensure(
            typeof input[p.name] === 'string',
            400,
            'INVALID_PARAMETER',
            '参数应为字符串形式的查询值',
          )
        ensure(
          !p.required || (input[p.name] !== undefined && input[p.name] !== ''),
          400,
          'INVALID_PARAMETER',
          '缺少必填参数 ' + p.name,
        )
        if (p.type === 'number' && input[p.name] !== undefined)
          ensure(
            /^-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$/.test(input[p.name]!),
            400,
            'INVALID_PARAMETER',
            '参数类型错误 ' + p.name,
          )
      }
      const table = find(state.tables, service.tableId)
      let rows = table.sample.filter((row) =>
        Object.entries(input).every(([key, value]) => value === '' || String(row[key]) === value),
      )
      if (service.sortField)
        rows = [...rows].sort((a, b) =>
          String(a[service.sortField]).localeCompare(String(b[service.sortField])),
        )
      service.callCount++
      audit(state, userId, 'call', 'services', service.id, '模拟查询调用')
      return rows
        .slice(0, service.pageSize)
        .map((row) =>
          Object.fromEntries(
            service.fields.filter((key) => allowed.has(key)).map((key) => [key, row[key] ?? null]),
          ),
        )
    },
    { input: 'ServiceCall', readAction: true },
  ),
]
