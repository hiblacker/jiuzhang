import type { SourceInput } from '../api/source-repository'

export const connectorOptions = [
  { label: 'MySQL', value: 'MySQL' as const },
  { label: 'OceanBase (MySQL)', value: 'OceanBase' as const },
  { label: 'PostgreSQL', value: 'PostgreSQL' as const },
  { label: 'Excel', value: 'Excel' as const },
]

export function defaultSourcePort(type: SourceInput['type']): number {
  if (type === 'PostgreSQL') return 5432
  return type === 'OceanBase' ? 2881 : 3306
}

export function newSource(type: SourceInput['type'] = 'MySQL'): SourceInput {
  return {
    name: '',
    description: '',
    owner: '数据平台组',
    tags: [],
    type,
    settings: {
      host: '',
      port: defaultSourcePort(type),
      database: '',
      schema: type === 'PostgreSQL' ? 'public' : '',
      tls: true,
      method: 'GET',
      baseUrl: '',
      path: '',
      headers: '{}',
      query: '{}',
      body: '{}',
      authType: 'none',
      pagination: 'none',
      dataPath: '',
      incrementalField: '',
      rateLimit: 1,
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
