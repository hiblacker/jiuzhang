import type { Model } from '@/shared/api/types'
import { nextId } from '../db'
import { sampleRows, type MockState } from '../fixtures/seed'
import { route, ensure, find } from './core'
import { evaluateQuality } from '../model/quality-runtime'
import { maskValue, executeGraph, convertValue } from '../model/dataset-runtime'
import { scheduleIssues } from '../model/schedule'
import { folderScope } from '../model/folders'
import { captureSourceSchemas, referencedObjectIds } from '../model/source-snapshot'
import { visiblePreview } from '../model/data-access'
import { resolveFieldOrigins } from '../model/field-origins'
import { mockNow } from '../model/scheduler'
export function definitionIssues(state: MockState, definition: Model<'DatasetDefinition'>) {
  const issues: string[] = []
  if (
    !state.objects.some(
      (x) => x.id === definition.objectId && x.sourceId === definition.sourceId,
    ) &&
    !state.versions.some((x) => x.datasetId === definition.upstreamDatasetId)
  )
    issues.push('请选择有效源对象或已发布上游数据集')
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(definition.output.table))
    issues.push('目标表名仅支持字母、数字和下划线，不能数字开头')
  if (definition.fields.some((field) => !field.name.trim() || !field.target.trim()))
    issues.push('字段名不能为空')
  if (definition.output.writeMode === 'upsert' && !definition.output.keys.length)
    issues.push('主键更新需要至少一个业务主键')
  if (
    definition.output.keys.some(
      (key) => !definition.fields.some((field) => field.output && field.target === key),
    )
  )
    issues.push('业务主键必须包含在输出字段中')
  if (!definition.fields.some((x) => x.output)) issues.push('至少输出一个字段')
  const names = definition.fields.filter((x) => x.output).map((x) => x.target)
  if (new Set(names).size !== names.length) issues.push('输出字段名不能重复')
  const visiting = new Set<string>(),
    done = new Set<string>()
  function cycle(id: string): boolean {
    if (visiting.has(id)) return true
    if (done.has(id)) return false
    visiting.add(id)
    for (const edge of definition.edges.filter((x) => x.source === id)) {
      if (cycle(edge.target)) return true
    }
    visiting.delete(id)
    done.add(id)
    return false
  }
  if (definition.nodes.some((node) => cycle(node.id))) issues.push('加工图存在循环依赖')
  if (
    definition.edges.some(
      (edge) =>
        !definition.nodes.some((n) => n.id === edge.source) ||
        !definition.nodes.some((n) => n.id === edge.target),
    )
  )
    issues.push('连线引用不存在的节点')
  if (definition.qualityRuleIds.some((id) => !state.quality.some((x) => x.id === id)))
    issues.push('质量规则不存在')
  if (definition.maskPolicyIds.some((id) => !state.masking.some((x) => x.id === id)))
    issues.push('脱敏策略不存在')
  if (
    definition.fields.some(
      (field) =>
        field.maskPolicyId && !state.masking.some((policy) => policy.id === field.maskPolicyId),
    )
  )
    issues.push('字段引用的脱敏策略不存在')
  return issues
}
export function datasetPreview(
  state: MockState,
  definition: Model<'DatasetDefinition'>,
  boundVersion?: Model<'DatasetVersion'>,
  ancestors: string[] = [],
  evaluatedAt = mockNow(state),
): Model<'Preview'> {
  const originalState = state
  if (boundVersion)
    ensure(
      referencedObjectIds(definition).every((id) =>
        boundVersion.sourceSnapshots.some((snapshot) => snapshot.object.id === id),
      ),
      422,
      'VALIDATION_ERROR',
      '绑定版本缺少源结构快照',
    )
  if (boundVersion)
    state = {
      ...state,
      objects: boundVersion.sourceSnapshots.map((snapshot) => snapshot.object),
      quality: boundVersion.qualitySnapshot,
      masking: boundVersion.maskingSnapshot,
    }
  const issues = definitionIssues(state, definition)
  ensure(!issues.length, 422, 'VALIDATION_ERROR', issues.join('；'))
  if (definition.mode === 'sql')
    ensure(
      [
        'SELECT * FROM orders LIMIT 12',
        'SELECT id, customer, amount FROM orders LIMIT 12',
      ].includes(definition.sql.trim()),
      422,
      'UNSUPPORTED_SQL',
      '仅支持编辑器提供的两条预设 SQL',
    )
  function sourceRows(objectId: string) {
    const object = state.objects.find((object) => object.id === objectId)
    ensure(
      object,
      422,
      'VALIDATION_ERROR',
      boundVersion ? '绑定版本缺少源结构快照' : '输入节点配置应为已存在源对象 ID',
    )
    return sampleRows.map((row) =>
      Object.fromEntries(object.fields.map((field) => [field.name, row[field.name] ?? null])),
    )
  }
  let rows: Model<'Row'>[] = definition.upstreamDatasetId ? [] : sourceRows(definition.objectId)
  const sensitiveOrigins = new Set<string>()
  function sourceOrigins(objectId: string) {
    const object = state.objects.find((object) => object.id === objectId)
    ensure(object, 422, 'VALIDATION_ERROR', '输入对象缺少字段结构')
    return new Map(
      object.fields.map((field) => {
        const key = object.id + ':' + field.name
        if (field.sensitive) sensitiveOrigins.add(key)
        return [field.name, new Set([key])]
      }),
    )
  }
  let inputOrigins = definition.upstreamDatasetId
    ? new Map<string, Set<string>>()
    : sourceOrigins(definition.objectId)
  if (definition.upstreamDatasetId) {
    ensure(
      !ancestors.includes(definition.upstreamDatasetId),
      422,
      'VALIDATION_ERROR',
      '上游数据集存在循环依赖',
    )
    const upstream = state.versions
      .filter((version) => version.datasetId === definition.upstreamDatasetId)
      .reverse()
      .find((version) => !boundVersion || version.version === boundVersion.upstreamVersion)
    ensure(upstream, 409, 'VERSION_CONFLICT', '上游发布版本不存在')
    const upstreamPreview = datasetPreview(
      originalState,
      upstream.definition,
      upstream,
      [...ancestors, definition.upstreamDatasetId],
      evaluatedAt,
    )
    rows = upstreamPreview.rows
    inputOrigins = new Map(
      upstreamPreview.fields.map((field) => {
        const key = 'dataset:' + upstream.datasetId + ':' + upstream.version + ':' + field.target
        if (field.sensitive) sensitiveOrigins.add(key)
        return [field.target, new Set([key])]
      }),
    )
  }
  if (definition.mode === 'visual') {
    try {
      rows = executeGraph(definition, rows, sourceRows)
    } catch (error) {
      ensure(
        false,
        422,
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : '加工图配置无效',
      )
    }
  }
  if (definition.cleaning.includes('trim'))
    rows = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
      ),
    )
  if (definition.cleaning.includes('fill-null'))
    rows = rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? '未提供' : v])),
    )
  if (definition.cleaning.includes('deduplicate'))
    rows = rows.filter((row, index, all) => all.findIndex((x) => x.id === row.id) === index)
  const origins = resolveFieldOrigins(definition, inputOrigins, sourceOrigins)
  let fields = definition.fields
    .filter((f) => f.output)
    .map((field) => ({
      ...field,
      sensitive:
        field.sensitive ||
        [...(origins.get(field.name) ?? [])].some((origin) => sensitiveOrigins.has(origin)),
    }))
  if (definition.mode === 'sql' && definition.sql.includes('id, customer, amount'))
    fields = fields.filter((f) => ['id', 'customer', 'amount'].includes(f.name))
  let output: Model<'Row'>[]
  try {
    output = rows.map((row) => {
      const record: Model<'Row'> = {}
      for (const field of fields) {
        const policy = state.masking.find((p) => p.id === field.maskPolicyId && p.enabled)
        if (policy?.kind === 'remove') continue
        let value = convertValue(row[field.name] ?? null, field)
        if (policy || field.sensitive) value = maskValue(value, policy)
        record[field.target] = value
      }
      return record
    })
  } catch (error) {
    ensure(false, 422, 'VALIDATION_ERROR', error instanceof Error ? error.message : '字段转换无效')
  }
  return {
    fields: fields.filter(
      (f) =>
        !state.masking.some((p) => p.id === f.maskPolicyId && p.enabled && p.kind === 'remove'),
    ),
    rows: output,
    qualityResults: state.quality
      .filter((rule) => rule.enabled && definition.qualityRuleIds.includes(rule.id))
      .map((rule) => evaluateQuality(rule, rows, evaluatedAt)),
    notes: ['合成样本变换演示；SQL 只支持预设语句，不是数据库执行器'],
  }
}
export const datasetHandlers = [
  route(
    'get',
    '/datasets',
    ({ state, url }) => {
      const publishedOnly = url.searchParams.get('publishedOnly')
      ensure(
        publishedOnly === null || publishedOnly === 'true' || publishedOnly === 'false',
        422,
        'VALIDATION_ERROR',
        'publishedOnly 仅支持 true 或 false',
      )
      const excludedId = url.searchParams.get('excludeId')
      const qualityRuleId = url.searchParams.get('qualityRuleId')
      const maskPolicyId = url.searchParams.get('maskPolicyId')
      const datasets = state.datasets.filter(
        (dataset) =>
          dataset.id !== excludedId &&
          (publishedOnly !== 'true' || dataset.publishedVersion > 0) &&
          (!qualityRuleId || dataset.definition.qualityRuleIds.includes(qualityRuleId)) &&
          (!maskPolicyId ||
            dataset.definition.maskPolicyIds.includes(maskPolicyId) ||
            dataset.definition.fields.some((field) => field.maskPolicyId === maskPolicyId)),
      )
      const folderId = url.searchParams.get('folderId')
      if (!folderId) return datasets
      if (folderId === 'none') return datasets.filter((dataset) => dataset.folderId === null)
      find(state.folders, folderId)
      const ids = folderScope(state.folders, folderId)
      return datasets.filter((dataset) => dataset.folderId !== null && ids.has(dataset.folderId))
    },
    { list: true },
  ),
  route(
    'post',
    '/datasets/preview',
    ({ state, body, role }) =>
      visiblePreview(
        state,
        role,
        datasetPreview(state, (body as Model<'DatasetInput'>).definition),
      ),
    { input: 'DatasetInput', readAction: true },
  ),
  route(
    'post',
    '/datasets',
    ({ state, body, now }) => {
      const input = body as Model<'DatasetInput'>
      if (input.folderId) find(state.folders, input.folderId)
      ensure(input.name.trim(), 422, 'VALIDATION_ERROR', '请填写名称')
      ensure(
        !state.datasets.some((x) => x.name === input.name),
        409,
        'DUPLICATE_NAME',
        '名称已存在',
      )
      const d: Model<'Dataset'> = {
        ...input,
        folderId: input.folderId ?? null,
        id: nextId(state),
        updatedAt: now,
        status: 'draft',
        publishedVersion: 0,
      }
      state.datasets.unshift(d)
      return d
    },
    { input: 'DatasetInput', created: true },
  ),
  route('get', '/datasets/{id}', ({ state, params }) => find(state.datasets, params.id)),
  route(
    'patch',
    '/datasets/{id}',
    ({ state, params, body, now }) => {
      const d = find(state.datasets, params.id)
      const input = { ...d, ...(body as Model<'DatasetInputPatch'>) }
      if (input.folderId) find(state.folders, input.folderId)
      ensure(input.name.trim(), 422, 'VALIDATION_ERROR', '请填写名称')
      ensure(
        !state.datasets.some((x) => x.id !== d.id && x.name === input.name),
        409,
        'DUPLICATE_NAME',
        '名称已存在',
      )
      Object.assign(d, input, {
        status: (body as Model<'DatasetInputPatch'>).definition ? 'draft' : d.status,
        updatedAt: now,
      })
      return d
    },
    { input: 'DatasetInput' },
  ),
  route('delete', '/datasets/{id}', ({ state, params }) => {
    const d = find(state.datasets, params.id)
    ensure(
      !state.tasks.some((t) => t.datasetId === d.id) &&
        !state.runs.some((r) => r.datasetId === d.id) &&
        !state.datasets.some((x) => x.definition.upstreamDatasetId === d.id) &&
        !state.versions.some((x) => x.definition.upstreamDatasetId === d.id) &&
        !state.tables.some((x) => x.datasetId === d.id),
      409,
      'DEPENDENCY_CONFLICT',
      '存在任务、历史运行或下游引用',
    )
    state.datasets = state.datasets.filter((x) => x.id !== d.id)
    return { message: '已删除' }
  }),
  route(
    'post',
    '/datasets/{id}/copy',
    ({ state, params, now }) => {
      const d = find(state.datasets, params.id)
      const copy = {
        ...structuredClone(d),
        id: nextId(state),
        name: d.name + ' 副本 ' + state.counter,
        publishedVersion: 0,
        status: 'draft' as const,
        updatedAt: now,
      }
      state.datasets.unshift(copy)
      return copy
    },
    { created: true },
  ),
  route(
    'post',
    '/datasets/{id}/validate',
    ({ state, params }) => {
      const issues = definitionIssues(state, find(state.datasets, params.id).definition)
      return { valid: issues.length === 0, issues }
    },
    { readAction: true },
  ),
  route(
    'post',
    '/datasets/{id}/preview',
    ({ state, params, role }) =>
      visiblePreview(
        state,
        role,
        datasetPreview(state, find(state.datasets, params.id).definition),
      ),
    { readAction: true },
  ),
  route('post', '/datasets/{id}/publish', ({ state, params, now }) => {
    const d = find(state.datasets, params.id)
    const issues = [
      ...definitionIssues(state, d.definition),
      ...scheduleIssues(
        state,
        state.tasks.find((task) => task.datasetId === d.id)?.id ?? '',
        d.definition.schedule,
      ),
    ]
    ensure(!issues.length, 422, 'VALIDATION_ERROR', issues.join('；'))
    datasetPreview(state, d.definition)
    const sourceSnapshots = captureSourceSchemas(state.objects, state.sources, d.definition)
    ensure(
      sourceSnapshots.length === referencedObjectIds(d.definition).length,
      422,
      'VALIDATION_ERROR',
      '源结构快照不完整',
    )
    const v: Model<'DatasetVersion'> = {
      id: nextId(state),
      datasetId: d.id,
      version: d.publishedVersion + 1,
      createdAt: now,
      name: d.name,
      definition: structuredClone(d.definition),
      sourceSnapshots,
      sourceSnapshotOrigin: 'published',
      sourceSnapshotCapturedAt: now,
      qualitySnapshot: structuredClone(
        state.quality.filter((rule) => d.definition.qualityRuleIds.includes(rule.id)),
      ),
      maskingSnapshot: structuredClone(
        state.masking.filter(
          (rule) =>
            d.definition.maskPolicyIds.includes(rule.id) ||
            d.definition.fields.some((field) => field.maskPolicyId === rule.id),
        ),
      ),
      upstreamVersion:
        state.datasets.find((dataset) => dataset.id === d.definition.upstreamDatasetId)
          ?.publishedVersion ?? 0,
    }
    state.versions.push(v)
    d.publishedVersion = v.version
    d.status = 'published'
    d.updatedAt = now
    const task = state.tasks.find((t) => t.datasetId === d.id)
    if (task) task.schedule = structuredClone(d.definition.schedule)
    else
      state.tasks.unshift({
        id: nextId(state),
        datasetId: d.id,
        name: d.name + '调度',
        description: '模拟调度，关闭浏览器不会执行',
        owner: d.owner,
        tags: d.tags,
        updatedAt: now,
        enabled: true,
        lastSuccessRunId: '',
        lastSuccessAt: null,
        schedule: structuredClone(d.definition.schedule),
      })
    return v
  }),
  route('get', '/datasets/{id}/versions', ({ state, params }) => {
    find(state.datasets, params.id)
    return state.versions
      .filter((v) => v.datasetId === params.id)
      .sort((a, b) => b.version - a.version)
  }),
  route('get', '/datasets/{id}/versions/{version}', ({ state, params }) => {
    const v = state.versions.find(
      (v) => v.datasetId === params.id && String(v.version) === params.version,
    )
    ensure(v, 404, 'NOT_FOUND', '版本不存在')
    return v
  }),
  route('post', '/datasets/{id}/versions/{version}/restore', ({ state, params, now }) => {
    const d = find(state.datasets, params.id)
    const v = state.versions.find(
      (v) => v.datasetId === d.id && String(v.version) === params.version,
    )
    ensure(v, 404, 'NOT_FOUND', '版本不存在')
    d.definition = structuredClone(v.definition)
    d.status = 'draft'
    d.updatedAt = now
    return d
  }),
]
