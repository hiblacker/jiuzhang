import type { SourceInput } from '../api/source-repository'
export const connectorRegistry: Record<
  SourceInput['type'],
  {
    kind: 'database' | 'api' | 'file'
    port: number
    schema: boolean
    incremental: boolean
    rateLimit: boolean
  }
> = {
  MySQL: { kind: 'database', port: 3306, schema: false, incremental: true, rateLimit: false },
  PostgreSQL: { kind: 'database', port: 5432, schema: true, incremental: true, rateLimit: false },
  'SQL Server': { kind: 'database', port: 1433, schema: true, incremental: true, rateLimit: false },
  Oracle: { kind: 'database', port: 1521, schema: true, incremental: true, rateLimit: false },
  Doris: { kind: 'database', port: 9030, schema: false, incremental: true, rateLimit: false },
  ClickHouse: { kind: 'database', port: 8123, schema: false, incremental: true, rateLimit: false },
  'REST API': { kind: 'api', port: 443, schema: false, incremental: true, rateLimit: true },
  CSV: { kind: 'file', port: 0, schema: false, incremental: false, rateLimit: false },
}
export const connectorTypes = [
  'MySQL',
  'PostgreSQL',
  'SQL Server',
  'Oracle',
  'Doris',
  'ClickHouse',
  'REST API',
  'CSV',
] as const
export const connectorOptions = connectorTypes.map((type) => ({ label: type, value: type }))
export function newSource(): SourceInput {
  return {
    name: '',
    description: '',
    owner: '数据平台组',
    tags: [],
    type: 'MySQL',
    settings: {
      host: import.meta.env.VITE_API_MODE === 'mock' ? 'demo-db.invalid' : '',
      port: 3306,
      database: import.meta.env.VITE_API_MODE === 'mock' ? 'retail_demo' : '',
      schema: 'public',
      tls: true,
      method: 'GET',
      baseUrl: import.meta.env.VITE_API_MODE === 'mock' ? 'https://demo-api.invalid' : '',
      path: '/customers',
      headers: '{}',
      query: '{}',
      body: '{}',
      authType: 'none',
      pagination: 'page',
      dataPath: 'data.items',
      incrementalField: 'updated_at',
      rateLimit: 60,
    },
  }
}
export function toSourceInput(source: SourceInput): SourceInput {
  return {
    name: source.name,
    description: source.description,
    owner: source.owner,
    tags: [...source.tags],
    type: source.type,
    settings: { ...source.settings },
  }
}
