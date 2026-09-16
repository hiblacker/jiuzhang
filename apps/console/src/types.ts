export type Row = Record<string, unknown>
export type Role = 'OWNER' | 'ENGINEER' | 'VIEWER'
export interface Project extends Row {
  id: number
  code: string
  name: string
  role: Role
}
export interface Dataset extends Row {
  id: number
  code: string
  name: string
  active_model_version: number
  active_release_id: number | null
}
export interface Plan extends Row {
  id: number
  source_code: string
  active_version: number
  kind: string
  state: string
  runtime_ref: string
  inventory_version: number | null
  trigger_time: string
  timezone: string
  start_date: string
  historical_read: boolean
  max_attempts: number
  timeout_seconds: number
  contract: Row
}
export interface Source extends Row {
  id: number
  code: string
  sourceType: string
  state: string
}
export interface Page<T> {
  items: T[]
  limit: number
  offset: number
  count: number
}
export interface QueryResult {
  datasetId: number
  releaseId: number
  policyRevision: number
  columns: string[]
  rows: Row[]
  offset: number
  limit: number
}
export interface Column {
  key: string
  title: string
  width?: number
  state?: boolean
}
export interface Action {
  label: string
  run: () => void
  danger?: boolean
}
export interface Field {
  key: string
  label: string
  type?: 'text' | 'number' | 'select' | 'json' | 'date' | 'time' | 'switch' | 'textarea'
  required?: boolean
  min?: number
  max?: number
  options?: { label: string, value: string | number }[]
  disabled?: boolean
}
export function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
}
export function display(value: unknown): string {
  return value == null || value === ''
    ? '-'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
}
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}
