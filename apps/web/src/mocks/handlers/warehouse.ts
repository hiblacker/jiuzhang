import type { Model } from '@/shared/api/types'
import { parseCsv, toCsv } from '@/shared/lib/csv'
import { nextId } from '../db'
import { route, ensure, find, audit } from './core'
import { advanceRuns } from './jobs'
import type { MockState } from '../fixtures/seed'
import { mockNow } from '../model/scheduler'
import { visibleFields, visibleTable, visibleQuery, selectColumns } from '../model/data-access'

function privateQuery(state: MockState, id: unknown, userId: string) {
  const query = find(state.queries, id)
  ensure(query.userId === userId, 403, 'FORBIDDEN', '查询仅对创建者可见')
  return query
}
function exportView(state: MockState, role: string, item: Model<'Export'>): Model<'Export'> {
  const query = state.queries.find((query) => query.id === item.queryId)
  const allowed = query ? visibleQuery(state, role, query).columns : []
  if (item.columns.some((column) => !allowed.includes(column)))
    return { ...item, status: 'failed', content: '' }
  return { ...item, content: item.status === 'ready' ? item.content : '' }
}
export function advanceTransfers(state: MockState, now = mockNow(state)) {
  let changed = false
  for (const task of state.imports) {
    if (!['queued', 'running'].includes(task.status)) continue
    const previousStatus = task.status,
      previousProgress = task.progress,
      elapsed = Math.max(0, now - Date.parse(task.createdAt))
    task.progress = Math.min(95, Math.floor(elapsed / 25))
    task.status = 'running'
    if (previousStatus !== task.status)
      audit(state, 'worker-demo', 'running', 'imports', task.id, '模拟导入开始')
    changed ||= task.status !== previousStatus || task.progress !== previousProgress
    if (elapsed < 2500) continue
    changed = true
    const pending = state.pendingImports[task.id]
    if (
      !pending ||
      pending.outcome === 'failed' ||
      state.tables.some((table) => table.name === pending.table.name)
    ) {
      task.status = 'failed'
      task.error = '模拟导入失败，目标表未写入'
    } else {
      state.tables.unshift(pending.table)
      task.tableId = pending.table.id
      task.rowCount = pending.table.rowCount
      task.status = 'succeeded'
    }
    task.progress = 100
    delete state.pendingImports[task.id]
    audit(state, 'worker-demo', task.status, 'imports', task.id, task.error || '模拟导入完成')
  }
  for (const task of state.exports) {
    if (task.status === 'preparing') {
      const previousProgress = task.progress,
        elapsed = Math.max(0, now - Date.parse(task.createdAt))
      task.progress = Math.min(95, Math.floor(elapsed / 15))
      changed ||= task.progress !== previousProgress
      if (elapsed < 1500) continue
      changed = true
      task.status = state.pendingExports[task.id] ?? 'failed'
      task.progress = 100
      if (task.status === 'failed') task.content = ''
      delete state.pendingExports[task.id]
      audit(state, 'worker-demo', task.status, 'exports', task.id, '模拟导出任务完成')
    }
    if (task.status === 'ready' && Date.parse(task.expiresAt) <= now) {
      task.status = 'expired'
      task.content = ''
      changed = true
      audit(state, 'worker-demo', 'expired', 'exports', task.id, '演示导出文件已过期')
    }
  }
  return changed
}
export function advanceQueries(state: MockState, now = mockNow(state)) {
  let changed = false
  for (const query of state.queries) {
    if (query.status !== 'running' || now - Date.parse(query.createdAt) < 2500) continue
    changed = true
    const table = state.tables.find((table) => table.id === query.tableId)
    if (!table) {
      query.status = 'failed'
      audit(state, 'worker-demo', 'failed', 'queries', query.id, '模拟查询失败，来源表不存在')
      continue
    }
    query.rows = selectColumns(table.sample.slice(0, 100), query.columns)
    query.status = 'succeeded'
    audit(state, 'worker-demo', 'succeeded', 'queries', query.id, '模拟查询完成')
  }
  return changed
}
export const warehouseHandlers = [
  route('get', '/warehouse/subject-domains', ({ state }) =>
    [...new Set(state.tables.map((table) => table.subjectDomain).filter(Boolean))].sort(),
  ),
  route('get', '/warehouse/metrics', ({ state, url }) => {
    advanceRuns(state)
    advanceTransfers(state)
    advanceQueries(state)
    const id = url.searchParams.get('tableId')
    if (id) find(state.tables, id)
    const tables = state.tables.filter((table) => !id || table.id === id)
    const queries = state.queries.filter(
      (query) => (!id || query.tableId === id) && query.status === 'succeeded',
    )
    const writes = state.runs.filter(
      (run) => (!id || run.outputTableId === id) && run.status === 'succeeded',
    )
    const imports = state.imports.filter(
      (task) => (!id || task.tableId === id) && task.status === 'succeeded',
    )
    const dates = Array.from({ length: 7 }, (_, i) =>
      new Date(mockNow(state) - (6 - i) * 86400000).toISOString().slice(0, 10),
    )
    return {
      layers: (['ODS', 'DWD', 'DWS', 'ADS'] as const).map((layer) => {
        const items = tables.filter((table) => table.layer === layer)
        return {
          layer,
          tableCount: items.length,
          rowCount: items.reduce((total, table) => total + BigInt(table.rowCount), 0n).toString(),
        }
      }),
      tableCount: tables.length,
      rowCount: tables.reduce((total, table) => total + BigInt(table.rowCount), 0n).toString(),
      sampleBytes: new TextEncoder().encode(JSON.stringify(tables.map((table) => table.sample)))
        .byteLength,
      activeRuns: state.runs.filter(
        (run) =>
          ['queued', 'running', 'validating', 'publishing'].includes(run.status) &&
          (!id || tables.some((table) => table.datasetId === run.datasetId)),
      ).length,
      queryCount: queries.length,
      writeCount: writes.length + imports.length,
      readRows: queries.reduce((total, query) => total + BigInt(query.rows.length), 0n).toString(),
      writtenRows: [...writes, ...imports]
        .reduce((total, run) => total + BigInt(run.rowCount), 0n)
        .toString(),
      trend: dates.map((date) => ({
        date,
        reads: queries.filter((query) => query.createdAt.startsWith(date)).length,
        writes:
          writes.filter((run) => run.finishedAt?.startsWith(date)).length +
          imports.filter((task) => task.createdAt.startsWith(date)).length,
        tables: tables.filter((table) => table.createdAt.slice(0, 10) <= date).length,
      })),
    }
  }),
  route(
    'get',
    '/warehouse/tables',
    ({ state, role, url }) => {
      advanceRuns(state)
      advanceTransfers(state)
      const domain = url.searchParams.get('subjectDomain')
      return state.tables
        .filter((table) => !domain || table.subjectDomain === (domain === 'none' ? '' : domain))
        .map((table) => visibleTable(state, role, table))
    },
    { list: true },
  ),
  route('get', '/warehouse/tables/{id}', ({ state, params, role }) => {
    advanceRuns(state)
    return visibleTable(state, role, find(state.tables, params.id))
  }),
  route(
    'get',
    '/queries',
    ({ state, role, userId }) => {
      advanceQueries(state)
      return state.queries
        .filter((query) => query.userId === userId)
        .map((query) => visibleQuery(state, role, query))
    },
    { list: true },
  ),
  route('get', '/queries/{id}', ({ state, params, role, userId }) => {
    advanceQueries(state)
    return visibleQuery(state, role, privateQuery(state, params.id, userId))
  }),
  route(
    'post',
    '/queries',
    ({ state, body, now, role, userId }) => {
      const sql = (body as Model<'QueryInput'>).sql.trim()
      const table = state.tables.find((t) => sql === 'SELECT * FROM ' + t.name + ' LIMIT 100')
      ensure(table, 422, 'UNSUPPORTED_SQL', '仅支持下拉框中已登记的示例查询')
      const q: Model<'Query'> = {
        id: nextId(state),
        userId,
        sql,
        status: 'running',
        tableId: table.id,
        rows: [],
        columns: visibleFields(state, role, table.fields).map((f) => f.target),
        createdAt: now,
      }
      state.queries.unshift(q)
      return q
    },
    { input: 'QueryInput', created: true, readAction: true, mutates: true },
  ),
  route(
    'post',
    '/queries/{id}/cancel',
    ({ state, params, userId, role }) => {
      advanceQueries(state)
      const q = privateQuery(state, params.id, userId)
      ensure(q.status === 'running', 409, 'STATE_CONFLICT', '查询已完成，不能取消')
      q.status = 'canceled'
      return visibleQuery(state, role, q)
    },
    { readAction: true, mutates: true },
  ),
  route(
    'get',
    '/imports',
    ({ state }) => {
      advanceTransfers(state)
      return state.imports
    },
    { list: true },
  ),
  route(
    'post',
    '/imports',
    ({ state, body, now }) => {
      const input = body as Model<'ImportInput'>
      ensure(
        new TextEncoder().encode(input.csv).byteLength <= 1000000,
        422,
        'VALIDATION_ERROR',
        '演示 CSV 限制 1 MB',
      )
      let rows: string[][]
      try {
        rows = parseCsv(input.csv)
      } catch (e) {
        ensure(false, 422, 'VALIDATION_ERROR', String(e))
      }
      ensure(rows.length <= 1001, 422, 'VALIDATION_ERROR', '最多 1000 行演示数据')
      ensure(
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.tableName) &&
          !state.tables.some((t) => t.name === input.tableName) &&
          !Object.values(state.pendingImports).some(
            (pending) => pending.table.name === input.tableName,
          ),
        409,
        'DUPLICATE_NAME',
        '目标表名为空或已存在',
      )
      ensure(
        input.mapping.length === rows[0]!.length &&
          new Set(input.mapping.map((m) => m.source)).size === input.mapping.length &&
          new Set(input.mapping.map((m) => m.target.trim())).size === input.mapping.length &&
          input.mapping.every((m) => m.target.trim() && rows[0]!.includes(m.source)),
        422,
        'VALIDATION_ERROR',
        '请为每列提供唯一输出名',
      )
      const sample = rows
        .slice(1)
        .map((row) =>
          Object.fromEntries(
            input.mapping.map((m) => [m.target, row[rows[0]!.indexOf(m.source)] ?? '']),
          ),
        )
      const fields: Model<'Field'>[] = input.mapping.map((m) => ({
        name: m.source,
        target: m.target,
        type: 'string',
        nullable: true,
        output: true,
        sensitive: false,
        maskPolicyId: '',
        description: '导入的虚构 CSV 字段',
      }))
      const table: Model<'Table'> = {
        id: nextId(state),
        subjectDomain: input.subjectDomain?.trim() ?? '',
        name: input.tableName,
        description: '用户确认的虚构 CSV 示例',
        createdAt: now,
        owner: '数据平台组',
        tags: ['CSV'],
        updatedAt: now,
        layer: input.layer,
        datasetId: '',
        datasetVersion: 0,
        sourceId: '',
        rowCount: String(sample.length),
        fields,
        sample,
        partitions: [now.slice(0, 10)],
        version: 1,
      }
      const task: Model<'Import'> = {
        id: nextId(state),
        name: input.name,
        tableId: '',
        status: 'queued',
        rowCount: '0',
        progress: 0,
        createdAt: now,
        error: '',
      }
      state.imports.unshift(task)
      state.pendingImports[task.id] = { table, outcome: input.outcome ?? 'succeeded' }
      return task
    },
    { input: 'ImportInput', created: true },
  ),
  route(
    'get',
    '/exports',
    ({ state, userId, role }) => {
      advanceTransfers(state)
      return state.exports
        .filter((item) => item.userId === userId)
        .map((item) => exportView(state, role, item))
    },
    { list: true },
  ),
  route('get', '/exports/{id}', ({ state, params, userId, role }) => {
    advanceTransfers(state)
    const item = find(state.exports, params.id)
    ensure(item.userId === userId, 403, 'FORBIDDEN', '导出仅对创建者可见')
    return exportView(state, role, item)
  }),
  route(
    'post',
    '/exports',
    ({ state, body, now, role, userId }) => {
      const input = body as Model<'ExportInput'>,
        query = visibleQuery(state, role, privateQuery(state, input.queryId, userId))
      ensure(query.status === 'succeeded', 409, 'STATE_CONFLICT', '仅成功查询可导出')
      const record: Model<'Export'> = {
        id: nextId(state),
        userId,
        columns: [...query.columns],
        queryId: query.id,
        format: input.format,
        status: 'preparing',
        progress: 0,
        fileName: 'jiuzhang-query-' + query.id + '.' + input.format,
        content:
          input.format === 'csv'
            ? toCsv(query.rows, query.columns)
            : JSON.stringify(query.rows, null, 2),
        createdAt: now,
        expiresAt: new Date(Date.parse(now) + 86400000).toISOString(),
      }
      state.exports.unshift(record)
      state.pendingExports[record.id] = input.outcome ?? 'ready'
      return exportView(state, role, record)
    },
    { input: 'ExportInput', created: true, readAction: true, mutates: true },
  ),
]
