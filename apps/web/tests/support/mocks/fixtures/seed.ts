import type { Model } from '@/shared/api/types'
import { captureSourceSchemas } from '../model/source-snapshot'
const at = '2026-10-15T01:00:00.000Z'
export const defaultSettings: Model<'SourceSettings'> = {
  host: 'demo-db.invalid',
  port: 3306,
  database: 'retail_demo',
  schema: 'public',
  tls: true,
  method: 'GET',
  baseUrl: 'https://demo-api.invalid',
  path: '/customers',
  headers: '{}',
  query: '{}',
  body: '{}',
  authType: 'none',
  pagination: 'page',
  dataPath: 'data.items',
  incrementalField: 'updated_at',
  rateLimit: 60,
}
export const defaultSchedule: Model<'Schedule'> = {
  mode: 'manual',
  cron: '0 9 * * *',
  intervalMinutes: 60,
  timezone: 'Asia/Shanghai',
  retries: 2,
  timeoutSeconds: 600,
  concurrency: 1,
  dependencies: [],
}
const fields: Model<'Field'>[] = [
  {
    name: 'id',
    target: 'id',
    type: 'string',
    nullable: false,
    output: true,
    sensitive: false,
    maskPolicyId: '',
    description: '业务主键',
  },
  {
    name: 'customer',
    target: 'customer',
    type: 'string',
    nullable: false,
    output: true,
    sensitive: false,
    maskPolicyId: '',
    description: '虚构客户',
  },
  {
    name: 'phone',
    target: 'phone',
    type: 'string',
    nullable: true,
    output: true,
    sensitive: true,
    maskPolicyId: '6001',
    description: '合成手机号',
  },
  {
    name: 'amount',
    target: 'amount',
    type: 'decimal(18,2)',
    nullable: false,
    output: true,
    sensitive: false,
    maskPolicyId: '',
    description: '订单金额，十进制字符串',
  },
  {
    name: 'city',
    target: 'city',
    type: 'string',
    nullable: true,
    output: true,
    sensitive: false,
    maskPolicyId: '',
    description: '城市',
  },
]
export const sampleRows: Model<'Row'>[] = Array.from({ length: 12 }, (_, i) => ({
  id: String(100 + i),
  customer: '演示客户 ' + (i + 1),
  phone: '1380000' + String(i).padStart(4, '0'),
  amount: 120 + i * 35 + '.50',
  city: ['杭州', '上海', '成都'][i % 3]!,
}))
export interface MockState {
  scheduler?: {
    offsetMs: number
    cursors: Record<string, { signature: string; nextAt: string | null }>
  }
  folders: Model<'DatasetFolder'>[]
  accessVersion: number
  sources: Model<'Source'>[]
  objects: Model<'SourceObject'>[]
  datasets: Model<'Dataset'>[]
  versions: Model<'DatasetVersion'>[]
  tasks: Model<'Task'>[]
  runs: Model<'Run'>[]
  tables: Model<'Table'>[]
  quality: Model<'Quality'>[]
  masking: Model<'Masking'>[]
  services: Model<'Service'>[]
  users: Model<'User'>[]
  roles: Model<'Role'>[]
  audit: Model<'Audit'>[]
  queries: Model<'Query'>[]
  imports: Model<'Import'>[]
  pendingImports: Record<string, { table: Model<'Table'>; outcome: 'succeeded' | 'failed' }>
  exports: Model<'Export'>[]
  pendingExports: Record<string, 'ready' | 'failed'>
  settings: Model<'Settings'>
  control: {
    domain:
      | 'all'
      | 'sources'
      | 'datasets'
      | 'tasks'
      | 'runs'
      | 'warehouse'
      | 'governance'
      | 'services'
      | 'system'
      | 'overview'
    scenario: 'normal' | 'empty' | 'error' | 'slow' | 'forbidden'
  }
  favoritesByUser: Record<string, string[]>
  /** Legacy shared favorites, consumed and removed by seedReady migration. */
  favorites?: string[]
  counter: number
  idempotency: Record<string, { fingerprint: string; data: unknown }>
}
export function createSeed(): MockState {
  const types: Model<'SourceType'>[] = [
    'MySQL',
    'PostgreSQL',
    'SQL Server',
    'Oracle',
    'Doris',
    'ClickHouse',
    'REST API',
    'CSV',
  ]
  const sources: Model<'Source'>[] = types.map((type, i) => ({
    id: String(1001 + i),
    name: [
      '零售订单库',
      '客户中心',
      '门店经营库',
      '财务账本',
      '分析数仓',
      '行为事件库',
      '营销开放接口',
      '库存示例文件',
    ][i]!,
    description: '虚构零售演示数据，不连接真实服务',
    owner: '数据平台组',
    tags: ['演示', type],
    type,
    status: i === 3 ? 'warning' : 'connected',
    settings: { ...defaultSettings, port: type === 'PostgreSQL' ? 5432 : 3306 },
    objectCount: 2,
    updatedAt: at,
  }))
  const objects: Model<'SourceObject'>[] = sources.flatMap((source, i) =>
    ['orders', 'customers'].map((name, j) => ({
      id: String(11001 + i * 2 + j),
      sourceId: source.id,
      name,
      rowCount: '12',
      fields: structuredClone(fields),
    })),
  )
  const names = [
    '订单明细宽表',
    '客户价值分层',
    '门店库存快照',
    '每日销售汇总',
    '商品销售排行',
    '退款明细',
    '营销转化分析',
    '会员画像',
    '区域经营汇总',
    '门店日指标',
    '订单质量监控',
    '财务经营指标',
    '渠道订单草稿',
    '商品成本草稿',
    '库存预警草稿',
  ]
  const datasets: Model<'Dataset'>[] = names.map((name, i) => ({
    id: String(2001 + i),
    folderId: String(12001 + (i % 3)),
    name,
    description: '基于合成零售样本的加工数据集',
    owner: '数据平台组',
    tags: ['零售', i % 2 ? '客户' : '订单'],
    updatedAt: at,
    status: i < 12 ? 'published' : 'draft',
    publishedVersion: i < 12 ? 1 : 0,
    definition: {
      sourceId: sources[i % 8]!.id,
      objectId: objects[(i % 8) * 2]!.id,
      upstreamDatasetId: '',
      mode: 'visual',
      sql: 'SELECT * FROM orders LIMIT 12',
      fields: structuredClone(fields),
      nodes: [
        { id: 'input', type: 'input', label: '读取源表', x: 40, y: 80, config: '' },
        { id: 'fields', type: 'fields', label: '字段映射', x: 320, y: 80, config: '' },
      ],
      edges: [{ id: 'input-fields', source: 'input', target: 'fields' }],
      cleaning: ['trim'],
      qualityRuleIds: ['5001'],
      maskPolicyIds: ['6001'],
      schedule: { ...defaultSchedule, mode: i < 12 ? 'cron' : 'manual', dependencies: [] },
      output: {
        subjectDomain: ['交易', '客户', '库存'][i % 3]!,
        table: ['dwd', 'dws', 'ods', 'ads'][i % 4] + '_retail_' + (i + 1),
        layer: (['DWD', 'DWS', 'ODS', 'ADS'] as const)[i % 4]!,
        keys: ['id'],
        writeMode: 'upsert',
      },
    },
  }))
  const versions: Model<'DatasetVersion'>[] = datasets
    .filter((x) => x.publishedVersion > 0)
    .map((d, i) => ({
      id: String(21001 + i),
      datasetId: d.id,
      version: 1,
      createdAt: at,
      name: d.name,
      definition: structuredClone(d.definition),
      qualitySnapshot: [],
      maskingSnapshot: [],
      upstreamVersion: 0,
      sourceSnapshots: captureSourceSchemas(objects, sources, d.definition),
      sourceSnapshotOrigin: 'published',
      sourceSnapshotCapturedAt: at,
    }))
  const tasks = datasets.slice(0, 12).map((d, i) => ({
    id: String(3001 + i),
    name: d.name + '调度',
    description: '演示定时任务；浏览器关闭后不执行',
    owner: d.owner,
    tags: ['演示'],
    updatedAt: at,
    datasetId: d.id,
    enabled: i !== 3,
    lastSuccessRunId: '',
    lastSuccessAt: null,
    schedule: structuredClone(d.definition.schedule),
  }))
  const tables: Model<'Table'>[] = Array.from({ length: 24 }, (_, i) => {
    const d = datasets[i % 12]!
    return {
      id: String(4001 + i),
      subjectDomain: ['交易', '客户', '库存'][i % 3]!,
      name: i < 12 ? d.definition.output.table : 'ods_snapshot_' + (i - 11),
      description: '模拟发布产物 · 12 行合成样本',
      createdAt: at,
      owner: d.owner,
      tags: d.tags,
      updatedAt: at,
      layer: i < 12 ? d.definition.output.layer : 'ODS',
      datasetId: d.id,
      datasetVersion: 1,
      sourceId: d.definition.sourceId,
      rowCount: '12',
      fields: structuredClone(fields),
      sample: sampleRows.map((row) => ({
        ...row,
        phone: String(row.phone).slice(0, 3) + '****' + String(row.phone).slice(-4),
      })),
      partitions: ['2026-10-15'],
      version: 1,
    }
  })
  const quality: Model<'Quality'>[] = Array.from({ length: 6 }, (_, i) => ({
    id: String(5001 + i),
    name: ['主键不能为空', '主键唯一', '金额有效范围', '城市枚举', '数据新鲜度', '客户名称必填'][
      i
    ]!,
    description: '使用合成样本验证',
    owner: '治理组',
    tags: ['质量'],
    updatedAt: at,
    kind: (['required', 'unique', 'range', 'enum', 'freshness', 'required'] as const)[i]!,
    field: ['id', 'id', 'amount', 'city', 'updated_at', 'customer'][i]!,
    parameter: ['', '', '0,100000', '杭州,上海,成都', '24', ''][i]!,
    severity: 'BLOCK',
    enabled: true,
    version: 1,
  }))
  const masking: Model<'Masking'>[] = Array.from({ length: 6 }, (_, i) => ({
    id: String(6001 + i),
    name: ['手机号掩码', '敏感字段移除', '金额区间', '客户名称掩码', '位置泛化', '邮箱掩码'][i]!,
    description: '仅演示，不构成数据安全保证',
    owner: '治理组',
    tags: ['脱敏'],
    updatedAt: at,
    kind: (['mask', 'remove', 'generalize', 'mask', 'generalize', 'mask'] as const)[i]!,
    parameter: '3,4',
    enabled: true,
    version: 1,
  }))
  for (const version of versions) {
    version.qualitySnapshot = structuredClone(
      quality.filter((rule) => version.definition.qualityRuleIds.includes(rule.id)),
    )
    version.maskingSnapshot = structuredClone(
      masking.filter(
        (rule) =>
          version.definition.maskPolicyIds.includes(rule.id) ||
          version.definition.fields.some((field) => field.maskPolicyId === rule.id),
      ),
    )
  }
  const runs: Model<'Run'>[] = Array.from({ length: 40 }, (_, i) => {
    let outcome: Model<'RunOutcome'> = 'succeeded'
    if (i % 13 === 0) outcome = 'blocked'
    else if (i % 9 === 0) outcome = 'failed'
    return {
      id: String(9001 + i),
      datasetId: datasets[i % 12]!.id,
      datasetVersion: 1,
      taskId: tasks[i % 12]!.id,
      retryOf: '',
      status: outcome,
      outcome: outcome,
      trigger: 'schedule',
      businessDate: null,
      executionStartedAt: new Date(Date.parse(at) - i * 3600000).toISOString(),
      scheduleSnapshot: structuredClone(tasks[i % 12]!.schedule),
      waitReason: '',
      startedAt: new Date(Date.parse(at) - i * 3600000).toISOString(),
      finishedAt: new Date(Date.parse(at) - i * 3600000 + 48000).toISOString(),
      durationMs: 48000,
      outputTableId: i % 13 === 0 || i % 9 === 0 ? '' : tables[i % 12]!.id,
      rowCount: i % 13 === 0 || i % 9 === 0 ? '0' : '12',
      logs: [
        '读取合成样本',
        '字段映射已完成',
        { blocked: 'BLOCK：质量检查阻断', failed: '模拟读取失败', succeeded: '模拟发布完成' }[
          outcome
        ],
      ],
      qualityResults:
        outcome === 'failed'
          ? []
          : [
              {
                ruleId: '5001',
                version: 1,
                result: i % 13 === 0 ? 'BLOCK' : 'PASS',
                message: i % 13 === 0 ? '合成失败场景' : '主键检查通过',
              },
            ],
      errorCode: { blocked: 'QUALITY_BLOCK', failed: 'READ_FAILED', succeeded: '' }[outcome],
    }
  })
  return {
    accessVersion: 1,
    folders: ['交易分析', '客户分析', '库存分析'].map((name, i) => ({
      id: String(12001 + i),
      name,
      parentId: null,
      updatedAt: at,
    })),
    sources,
    objects,
    datasets,
    versions,
    tasks,
    runs,
    tables,
    quality,
    masking,
    services: Array.from({ length: 6 }, (_, i) => ({
      id: String(7001 + i),
      name: datasets[i]!.name + '查询服务',
      description: '模拟 HTTP 查询接口',
      owner: '服务组',
      tags: ['零售'],
      updatedAt: at,
      tableId: tables[i]!.id,
      fields: ['id', 'customer', 'amount', 'city'],
      parameters: [{ name: 'city', type: 'string', required: false }],
      pageSize: 20,
      sortField: 'id',
      allowedRoles: ['admin', 'developer', 'viewer'],
      enabled: true,
      callCount: 0,
    })),
    users: Array.from({ length: 6 }, (_, i) => ({
      id: String(8001 + i),
      name: '演示用户 ' + (i + 1),
      role: (['admin', 'developer', 'viewer'] as const)[i % 3]!,
      enabled: true,
      updatedAt: at,
    })),
    roles: [
      {
        id: 'admin',
        name: '平台管理员',
        permissions: ['read', 'write', 'system', 'readSensitive'],
      },
      { id: 'developer', name: '数据开发者', permissions: ['read', 'write', 'readSensitive'] },
      { id: 'viewer', name: '只读分析师', permissions: ['read'] },
    ],
    audit: [
      {
        id: '10001',
        actor: 'system',
        action: 'seed',
        resource: 'demo',
        resourceId: '0',
        at,
        detail: '初始化合成演示数据',
      },
    ],
    queries: [],
    imports: [],
    pendingImports: {},
    exports: [],
    pendingExports: {},
    settings: { timezone: 'Asia/Shanghai', notifications: false },
    control: { domain: 'all', scenario: 'normal' },
    favoritesByUser: {},
    counter: 100000,
    idempotency: {},
  }
}
