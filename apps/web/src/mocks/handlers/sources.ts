import type { Model } from '@/shared/api/types'
import { nextId } from '../db'
import { sampleRows } from '../fixtures/seed'
import { route, ensure, find } from './core'
import { parseJsonObject } from '@/shared/lib/json'
import { sanitizeSourceSettings } from '../model/source-settings'
import { visibleFields } from '../model/data-access'
import { maskValue } from '../model/dataset-runtime'
function validateSource(input: Model<'SourceInput'>) {
  ensure(input.name.trim(), 422, 'VALIDATION_ERROR', '请填写数据源名称')
  ensure(input.owner.trim(), 422, 'VALIDATION_ERROR', '请填写负责人')
  for (const key of ['headers', 'query', 'body'] as const) {
    try {
      parseJsonObject(input.settings[key])
    } catch {
      ensure(false, 422, 'VALIDATION_ERROR', key + ' 必须是 JSON 对象')
    }
  }
  if (input.type === 'REST API') {
    let valid = false
    try {
      const url = new URL(input.settings.baseUrl)
      valid = url.protocol === 'https:' && !url.username && !url.password
    } catch {
      /* Validation below owns the response. */
    }
    ensure(valid, 422, 'VALIDATION_ERROR', '请输入不含用户名和密码的有效 HTTPS 地址')
    ensure(
      Number.isInteger(input.settings.rateLimit) &&
        input.settings.rateLimit >= 1 &&
        input.settings.rateLimit <= 10000,
      422,
      'VALIDATION_ERROR',
      '每分钟请求上限须为 1–10000 的整数',
    )
  } else if (input.type !== 'CSV') {
    ensure(
      input.settings.host.trim() && input.settings.database.trim(),
      422,
      'VALIDATION_ERROR',
      '请填写主机及数据库',
    )
    ensure(
      Number.isInteger(input.settings.port) &&
        input.settings.port > 0 &&
        input.settings.port <= 65535,
      422,
      'VALIDATION_ERROR',
      '端口范围为 1–65535',
    )
  }
}
function sanitized(input: Model<'SourceInput'>): Model<'SourceInput'> {
  return {
    ...input,
    settings: sanitizeSourceSettings(input.settings),
  }
}
export const sourceHandlers = [
  route('get', '/sources', ({ state }) => state.sources, { list: true }),
  route(
    'post',
    '/sources/test',
    ({ body }) => {
      const input = body as Model<'SourceInput'>
      validateSource(input)
      return {
        success: !input.name.includes('失败'),
        message: input.name.includes('失败')
          ? '模拟连接失败，请检查配置'
          : '模拟连接检查通过；未访问真实地址',
        latencyMs: 180,
      }
    },
    { input: 'SourceInput', readAction: true },
  ),
  route(
    'post',
    '/sources',
    ({ state, body, now }) => {
      const input = body as Model<'SourceInput'>
      validateSource(input)
      ensure(!state.sources.some((x) => x.name === input.name), 409, 'DUPLICATE_NAME', '名称已存在')
      const source: Model<'Source'> = {
        ...sanitized(input),
        id: nextId(state),
        status: 'connected',
        objectCount: 1,
        updatedAt: now,
      }
      state.sources.unshift(source)
      state.objects.push({
        id: nextId(state),
        sourceId: source.id,
        name: 'orders',
        rowCount: '12',
        fields: structuredClone(state.objects[0]!.fields),
      })
      return source
    },
    { input: 'SourceInput', created: true },
  ),
  route('get', '/sources/{id}', ({ state, params }) => find(state.sources, params.id)),
  route(
    'patch',
    '/sources/{id}',
    ({ state, params, body, now }) => {
      const source = find(state.sources, params.id)
      const input = { ...source, ...(body as Model<'SourceInputPatch'>) }
      validateSource(input)
      ensure(
        !state.sources.some((x) => x.id !== source.id && x.name === input.name),
        409,
        'DUPLICATE_NAME',
        '名称已存在',
      )
      Object.assign(source, sanitized(input), { updatedAt: now })
      return source
    },
    { input: 'SourceInput' },
  ),
  route('delete', '/sources/{id}', ({ state, params }) => {
    const source = find(state.sources, params.id)
    const refs = state.datasets.filter((x) => x.definition.sourceId === source.id)
    const referencesSource = (definition: Model<'DatasetDefinition'>) =>
      definition.sourceId === source.id ||
      definition.nodes.some(
        (node) =>
          node.type === 'input' &&
          state.objects.some(
            (object) => object.sourceId === source.id && object.id === node.config,
          ),
      )
    ensure(
      !state.datasets.some((dataset) => referencesSource(dataset.definition)) &&
        !state.versions.some(
          (version) =>
            referencesSource(version.definition) ||
            version.sourceSnapshots.some((snapshot) => snapshot.object.sourceId === source.id),
        ),
      409,
      'DEPENDENCY_CONFLICT',
      '被数据集或历史版本引用，不能删除：' + refs.map((x) => x.name).join('、'),
    )
    state.sources = state.sources.filter((x) => x.id !== source.id)
    state.objects = state.objects.filter((x) => x.sourceId !== source.id)
    return { message: '数据源已删除' }
  }),
  route(
    'post',
    '/sources/{id}/test',
    ({ state, params }) => {
      const source = find(state.sources, params.id)
      return {
        success: source.status !== 'offline',
        message: '模拟检查完成；未连接真实服务',
        latencyMs: 180,
      }
    },
    { readAction: true },
  ),
  route('get', '/sources/{id}/objects', ({ state, params }) => {
    find(state.sources, params.id)
    return state.objects.filter((x) => x.sourceId === params.id)
  }),
  route('get', '/sources/{id}/objects/{objectId}/fields', ({ state, params }) => {
    const object = find(state.objects, params.objectId)
    ensure(object.sourceId === params.id, 404, 'NOT_FOUND', '源对象不属于该数据源')
    return object.fields
  }),
  route(
    'post',
    '/sources/{id}/preview',
    ({ state, params, body, role }) => {
      const object = find(state.objects, (body as { objectId: string }).objectId)
      ensure(object.sourceId === params.id, 404, 'NOT_FOUND', '源对象不存在')
      const fields = visibleFields(state, role, object.fields)
      return {
        fields,
        rows: sampleRows.map((row) =>
          Object.fromEntries(
            fields.map((field) => [
              field.name,
              field.sensitive ? maskValue(row[field.name]) : (row[field.name] ?? null),
            ]),
          ),
        ),
        notes: [
          '固定合成样本；敏感字段显示掩码',
          ...(fields.length < object.fields.length ? ['当前角色隐藏敏感列。'] : []),
        ],
      }
    },
    { readAction: true },
  ),
]
