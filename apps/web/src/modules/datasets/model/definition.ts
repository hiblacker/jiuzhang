import type { DatasetInput } from '../api/dataset-repository'
export function newDataset(): DatasetInput {
  return {
    name: '',
    description: '',
    owner: '数据平台组',
    tags: [],
    definition: {
      sourceId: '',
      objectId: '',
      upstreamDatasetId: '',
      mode: 'visual',
      deliveryMode: 'warehouse',
      sql: '',
      fields: [],
      nodes: [{ id: 'input', type: 'input', label: '读取源表', x: 40, y: 80, config: '' }],
      edges: [],
      cleaning: [],
      qualityRuleIds: [],
      maskPolicyIds: [],
      schedule: {
        mode: 'manual',
        cron: '0 9 * * *',
        intervalMinutes: 60,
        timezone: 'Asia/Shanghai',
        retries: 0,
        timeoutSeconds: 600,
        concurrency: 1,
        dependencies: [],
      },
      output: {
        table: '',
        layer: 'DWD',
        subjectDomain: '',
        keys: [],
        writeMode: 'replace',
      },
    },
  }
}
export function toInput(value: DatasetInput): DatasetInput {
  const definition = JSON.parse(JSON.stringify(value.definition)) as DatasetInput['definition']
  definition.deliveryMode ??= 'warehouse'
  return {
    name: value.name,
    description: value.description,
    owner: value.owner,
    tags: [...value.tags],
    definition,
  }
}

/** Preserve MySQL decimal precision when creating the executable field mapping. */
export function sourceFieldType(type: string): string {
  if (/^(tinyint|smallint|mediumint|int|bigint)/i.test(type)) return 'integer'
  if (/^decimal\(\d+,\d+\)$/i.test(type)) return type.toLowerCase()
  if (type === 'date') return 'date'
  if (/^(datetime|timestamp)/i.test(type)) return 'datetime'
  return 'string'
}
