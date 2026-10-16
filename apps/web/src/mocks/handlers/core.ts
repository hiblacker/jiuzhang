import { http, HttpResponse, delay } from 'msw'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import contractText from '../../../../../packages/contracts/openapi.yaml?raw'
import { transact, nextId } from '../db'
import type { MockState } from '../fixtures/seed'
import { mockNow, synchronizeSchedules } from '../model/scheduler'
const contract = JSON.parse(contractText)
const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema({ ...contract, $id: 'jiuzhang' })
export class MockError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: string[] = [],
  ) {
    super(message)
  }
}
export function ensure(
  value: unknown,
  status: number,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new MockError(status, code, message)
}
export function find<T extends { id: string }>(items: T[], id: unknown): T {
  const item = items.find((x) => x.id === id)
  ensure(item, 404, 'NOT_FOUND', '资源不存在或已被删除')
  return item
}
export function validate(type: string, value: unknown) {
  const check = ajv.getSchema('jiuzhang#/components/schemas/' + type)
  ensure(check, 500, 'CONTRACT_ERROR', '契约类型不存在')
  if (!check(value))
    throw new MockError(
      422,
      'VALIDATION_ERROR',
      '请检查必填项及输入类型',
      check.errors?.map((x) => x.instancePath + ' ' + x.message) ?? [],
    )
}
export function audit(
  state: MockState,
  actor: string,
  action: string,
  resource: string,
  resourceId: string,
  detail = '演示操作',
) {
  state.audit.unshift({
    id: nextId(state),
    actor,
    action,
    resource,
    resourceId,
    detail,
    at: new Date(mockNow(state)).toISOString(),
  })
}
export interface Context {
  state: MockState
  body: unknown
  params: Record<string, string | readonly string[]>
  url: URL
  role: string
  userId: string
  now: string
  request: Request
}
type Method = 'get' | 'post' | 'patch' | 'delete'
export function route(
  method: Method,
  path: string,
  action: (ctx: Context) => unknown,
  options: {
    input?: string
    created?: boolean
    readAction?: boolean
    admin?: boolean
    list?: boolean
    mutates?: boolean
  } = {},
) {
  return http[method](
    '/api/v1' + path.replace(/\{(\w+)\}/g, ':$1'),
    async ({ request, params }) => {
      const requestId = crypto.randomUUID()
      const url = new URL(request.url)
      const role = request.headers.get('x-demo-role') ?? 'developer'
      try {
        const body =
          method === 'get' || method === 'delete'
            ? undefined
            : await request.text().then((t) => (t ? JSON.parse(t) : undefined))
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(body ?? null)),
        )
        const fingerprint =
          'sha256:' +
          Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
        const result = await transact((state) => {
          const domain = path.split('/')[1] ?? ''
          const control = state.control
          const controlDomain = ['queries', 'imports', 'exports'].includes(domain)
            ? 'warehouse'
            : domain
          const scenario =
            control.domain === 'all' || control.domain === controlDomain
              ? control.scenario
              : 'normal'
          if (domain !== 'demo' && domain !== 'session') {
            if (scenario === 'error')
              throw new MockError(500, 'DEMO_ERROR', '当前模块正在演示接口失败')
            if (scenario === 'forbidden')
              throw new MockError(403, 'FORBIDDEN', '当前模块正在演示无权限')
          }
          const roleEntry = state.roles.find((x) => x.id === role)
          ensure(roleEntry, 401, 'UNAUTHORIZED', '请选择有效演示角色')
          const requestedUserId = request.headers.get('x-demo-user')
          const user = requestedUserId
            ? state.users.find((user) => user.id === requestedUserId)
            : state.users.find((user) => user.enabled && user.role === role)
          if (domain !== 'demo' && path !== '/session/users') {
            ensure(
              user?.enabled && user.role === role,
              401,
              'UNAUTHORIZED',
              '演示用户已停用或与所选角色不匹配',
            )
          }
          if (domain !== 'demo' && domain !== 'session')
            ensure(roleEntry.permissions.includes('read'), 403, 'FORBIDDEN', '当前角色没有读取权限')
          if (options.admin)
            ensure(
              roleEntry.permissions.includes('system'),
              403,
              'FORBIDDEN',
              '该操作需要平台管理权限',
            )
          if (method !== 'get' && !options.readAction && domain !== 'demo')
            ensure(
              roleEntry.permissions.includes('write'),
              403,
              'FORBIDDEN',
              '当前角色没有写入权限',
            )
          if (options.input)
            validate(
              method === 'patch' && domain !== 'demo' ? options.input + 'Patch' : options.input,
              body,
            )
          else {
            const schema =
              contract.paths[path]?.[method]?.requestBody?.content?.['application/json']?.schema
            if (schema) {
              const check = ajv.compile({ ...schema, components: contract.components })
              ensure(check(body), 422, 'VALIDATION_ERROR', '请求体不符合接口契约')
            }
          }
          const key = request.headers.get('Idempotency-Key')
          const scopedKey =
            (user?.id ?? 'demo') +
            ':' +
            role +
            ':' +
            [...roleEntry.permissions].sort().join(',') +
            ':' +
            method +
            ':' +
            url.pathname +
            ':' +
            key
          if (key && state.idempotency[scopedKey]) {
            const previous = state.idempotency[scopedKey]
            ensure(
              previous.fingerprint === fingerprint,
              409,
              'IDEMPOTENCY_CONFLICT',
              '同一幂等键不能用于不同请求',
            )
            return { data: previous.data, scenario }
          }
          const data = action({
            state,
            body,
            params: params as Record<string, string | readonly string[]>,
            url,
            role,
            userId: user?.id ?? '',
            now: new Date(mockNow(state)).toISOString(),
            request,
          })
          synchronizeSchedules(state, mockNow(state))
          if (key) state.idempotency[scopedKey] = { fingerprint, data: structuredClone(data) }
          if (method !== 'get' && domain !== 'demo' && (!options.readAction || options.mutates)) {
            const resultIds = (Array.isArray(data) ? data : [data]).flatMap((item) =>
              item && typeof item === 'object' && 'id' in item ? [String(item.id)] : [],
            )
            audit(
              state,
              user?.id ?? role,
              method,
              domain,
              String(params.id ?? (data as { id?: string })?.id ?? path.split('/').at(-1)),
              method.toUpperCase() +
                ' ' +
                url.pathname +
                (resultIds.length ? ' → ' + resultIds.join(', ') : ''),
            )
          }
          return { data, scenario }
        })
        await delay(result.scenario === 'slow' ? 1800 : 180)
        if (options.list) {
          const items = Array.isArray(result.data) ? result.data : []
          const q = (url.searchParams.get('q') ?? '').toLowerCase()
          let filtered = items.filter(
            (item) => !q || JSON.stringify(item).toLowerCase().includes(q),
          )
          for (const field of [
            'status',
            'type',
            'layer',
            'trigger',
            'actor',
            'action',
            'resource',
            'resourceId',
            'kind',
            'owner',
            'datasetId',
            'taskId',
            'tableId',
          ]) {
            const value = url.searchParams.get(field)
            if (value) filtered = filtered.filter((item) => item[field] === value)
          }
          for (const field of ['enabled', 'certified', 'favorite']) {
            const value = url.searchParams.get(field)
            if (value === 'true' || value === 'false')
              filtered = filtered.filter((item) => item[field] === (value === 'true'))
          }
          const tag = url.searchParams.get('tag')
          if (tag) filtered = filtered.filter((item) => item.tags?.includes(tag))
          const from = url.searchParams.get('from'),
            to = url.searchParams.get('to')
          if (from)
            filtered = filtered.filter(
              (item) => (item.startedAt ?? item.at ?? item.createdAt ?? '') >= from,
            )
          if (to)
            filtered = filtered.filter(
              (item) =>
                (item.startedAt ?? item.at ?? item.createdAt ?? '') <= to + 'T23:59:59.999Z',
            )
          const sort = url.searchParams.get('sort')
          if (sort === 'name') filtered.sort((a, b) => String(a.name).localeCompare(String(b.name)))
          if (sort === 'updatedAt')
            filtered.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
          if (result.scenario === 'empty') filtered = []
          const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
          const pageSize = Math.min(
            100,
            Math.max(1, Number(url.searchParams.get('pageSize')) || 20),
          )
          return HttpResponse.json(
            {
              data: filtered.slice((page - 1) * pageSize, page * pageSize),
              meta: { requestId, page, pageSize, total: filtered.length },
            },
            { status: 200 },
          )
        }
        return HttpResponse.json(
          { data: result.data, meta: { requestId } },
          { status: options.created ? 201 : 200 },
        )
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError')
          return HttpResponse.json(
            {
              error: {
                code: 'STORAGE_FULL',
                message: 'Local demo storage is full',
                details: [],
                requestId,
              },
            },
            { status: 500 },
          )
        if (
          error instanceof DOMException &&
          [
            'UnknownError',
            'NotReadableError',
            'VersionError',
            'InvalidStateError',
            'SecurityError',
            'AbortError',
          ].includes(error.name)
        )
          return HttpResponse.json(
            {
              error: {
                code: 'STORAGE_UNAVAILABLE',
                message: 'Local demo storage is unavailable',
                details: [],
                requestId,
              },
            },
            { status: 500 },
          )
        const e =
          error instanceof MockError
            ? error
            : new MockError(500, 'INTERNAL_ERROR', '本地演示数据处理失败')
        return HttpResponse.json(
          { error: { code: e.code, message: e.message, details: e.details, requestId } },
          { status: e.status },
        )
      }
    },
  )
}
