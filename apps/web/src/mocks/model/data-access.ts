import type { Model } from '@/shared/api/types'
import type { MockState } from '../fixtures/seed'

export function visibleFields(state: MockState, role: string, fields: Model<'Field'>[]) {
  const sensitive = state.roles
    .find((entry) => entry.id === role)
    ?.permissions.includes('readSensitive')
  return fields.filter((field) => field.output && (!field.sensitive || sensitive))
}
export function selectColumns(rows: Model<'Row'>[], columns: string[]) {
  return rows.map((row) => Object.fromEntries(columns.map((key) => [key, row[key] ?? null])))
}
export function visiblePreview(
  state: MockState,
  role: string,
  preview: Model<'Preview'>,
): Model<'Preview'> {
  const fields = visibleFields(state, role, preview.fields)
  return {
    ...preview,
    fields,
    rows: selectColumns(
      preview.rows,
      fields.map((field) => field.target),
    ),
    notes:
      fields.length === preview.fields.length
        ? preview.notes
        : [...preview.notes, '当前角色隐藏敏感列。'],
  }
}
export function visibleTable(
  state: MockState,
  role: string,
  table: Model<'Table'>,
): Model<'Table'> {
  const fields = visibleFields(state, role, table.fields)
  return {
    ...table,
    fields,
    sample: selectColumns(
      table.sample,
      fields.map((field) => field.target),
    ),
  }
}
export function visibleQuery(
  state: MockState,
  role: string,
  query: Model<'Query'>,
): Model<'Query'> {
  const table = state.tables.find((table) => table.id === query.tableId)
  const allowed = new Set(
    visibleFields(state, role, table?.fields ?? []).map((field) => field.target),
  )
  const columns = query.columns.filter((column) => allowed.has(column))
  return { ...query, columns, rows: selectColumns(query.rows, columns) }
}
