import type { DatasetInput } from '../api/dataset-repository'
export function newDataset(): DatasetInput {
  return {
    folderId: null,
    name: '',
    description: '',
    owner: '数据平台组',
    tags: [],
    definition: {
      sourceId: '',
      objectId: '',
      upstreamDatasetId: '',
      mode: 'visual',
      sql: 'SELECT * FROM orders LIMIT 12',
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
        retries: 2,
        timeoutSeconds: 600,
        concurrency: 1,
        dependencies: [],
      },
      output: { table: '', layer: 'DWD', subjectDomain: '', keys: [], writeMode: 'upsert' },
    },
  }
}
export function toInput(value: DatasetInput): DatasetInput {
  return {
    folderId: value.folderId ?? null,
    name: value.name,
    description: value.description,
    owner: value.owner,
    tags: [...value.tags],
    definition: JSON.parse(JSON.stringify(value.definition)),
  }
}
