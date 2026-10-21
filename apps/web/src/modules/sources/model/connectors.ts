import type { SourceInput } from '../api/source-repository'

export const connectorOptions = [{ label: 'MySQL', value: 'MySQL' as const }]

export function newSource(): SourceInput {
  return {
    name: '',
    description: '',
    owner: '数据平台组',
    tags: [],
    type: 'MySQL',
    settings: {
      host: '',
      port: 3306,
      database: '',
      schema: '',
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
    type: 'MySQL',
    settings: { ...source.settings },
  }
}
