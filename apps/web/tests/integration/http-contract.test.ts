import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { IDBObjectStore } from 'fake-indexeddb'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import contractText from '../../../../packages/contracts/openapi.yaml?raw'
import { handlers } from '../support/mocks/handlers'
import { resetState, readState, transact } from '../support/mocks/db'
import { advanceQueries, advanceTransfers } from '../support/mocks/handlers/warehouse'
import { createRun, advanceRuns } from '../support/mocks/handlers/jobs'
import { resetTestOutcomes, testOutcomes } from '../support/mocks/fixtures/outcomes'

const server = setupServer(...handlers)
const contract = JSON.parse(contractText)
const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema({ ...contract, $id: 'contract' })
beforeAll(() => {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('http://localhost'),
    configurable: true,
  })
  server.listen({ onUnhandledFrame: 'error' })
})
beforeEach(async () => {
  resetTestOutcomes()
  await resetState()
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => {
  server.close()
  Reflect.deleteProperty(globalThis, 'location')
})

async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  role = 'admin',
  key?: string,
  userId?: string,
) {
  const response = await fetch('http://localhost/api/v1' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-demo-role': role,
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...(userId ? { 'x-demo-user': userId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  if (path.startsWith('/_test/')) return { status: response.status, body: data }
  const templates = Object.keys(contract.paths).filter(
    (template) => contract.paths[template][method.toLowerCase()],
  )
  templates.sort((a, b) => a.split('{').length - b.split('{').length)
  const template = templates.find((template) => {
    const route = template.split('/'),
      actual = path.split('?')[0]!.split('/')
    return (
      route.length === actual.length &&
      route.every((part, index) => part.startsWith('{') || part === actual[index])
    )
  })
  expect(template, path).toBeTruthy()
  const schema =
    contract.paths[template!][method.toLowerCase()].responses[response.status]?.content[
      'application/json'
    ].schema
  expect(schema, method + ' ' + path + ' ' + response.status).toBeTruthy()
  const check = ajv.compile({ ...schema, components: contract.components })
  expect(check(data), JSON.stringify(check.errors)).toBe(true)
  return { status: response.status, body: data }
}

describe('HTTP contract and persistence', () => {
  it('aggregates overview attention across all resources and filters failures before limiting', async () => {
    await transact((state) => {
      state.tasks.forEach((task) => {
        task.schedule.mode = 'manual'
      })
      const source = structuredClone(state.sources[0]!)
      state.sources = Array.from({ length: 123 }, (_, index) => ({
        ...structuredClone(source),
        id: String(98000 + index),
        status: index === 122 ? 'offline' : 'warning',
      }))
      const dataset = structuredClone(state.datasets[0]!)
      state.datasets = Array.from({ length: 121 }, (_, index) => ({
        ...structuredClone(dataset),
        id: String(99000 + index),
        status: 'draft',
      }))
      const run = structuredClone(state.runs[0]!)
      state.runs = Array.from({ length: 12 }, (_, index) => {
        let status: 'succeeded' | 'failed' | 'blocked' = 'succeeded'
        if (index >= 6) status = index % 2 === 0 ? 'failed' : 'blocked'
        const startedAt = new Date(
          Date.parse('2026-10-17T12:00:00Z') - index * 3600000,
        ).toISOString()
        return {
          ...structuredClone(run),
          id: String(97000 + index),
          status,
          outcome: status,
          startedAt,
          finishedAt: startedAt,
        }
      }).reverse()
    })
    const before = await readState()
    const result = await request('/overview')
    expect(result.body.data.attentionCounts).toEqual({
      draftDatasets: 121,
      warningSources: 122,
      offlineSources: 1,
    })
    expect(result.body.data.publishedCount).toBe(121)
    expect(result.body.data.recentRuns.map((run: { id: string }) => run.id)).toEqual([
      '97000',
      '97001',
      '97002',
      '97003',
      '97004',
    ])
    expect(result.body.data.recentFailures.map((run: { id: string }) => run.id)).toEqual([
      '97006',
      '97007',
      '97008',
      '97009',
      '97010',
    ])
    expect((await readState()).runs).toEqual(before.runs)
  })

  it('returns explicit empty failure and attention states for a healthy overview', async () => {
    await transact((state) => {
      state.sources.forEach((source) => {
        source.status = 'connected'
      })
      state.datasets.forEach((dataset) => {
        dataset.status = 'published'
      })
      state.runs = state.runs.filter((run) => run.status === 'succeeded')
    })
    const result = await request('/overview', 'GET', undefined, 'viewer')
    expect(result.body.data.recentFailures).toEqual([])
    expect(result.body.data.attentionCounts).toEqual({
      draftDatasets: 0,
      warningSources: 0,
      offlineSources: 0,
    })
    expect(result.body.data.recentRuns).toHaveLength(5)
  })

  it('filters draft quality and both masking reference forms before pagination and totals', async () => {
    await transact((state) => {
      const template = structuredClone(state.datasets[0]!)
      const unrelated = Array.from({ length: 121 }, (_, index) => ({
        ...structuredClone(template),
        id: String(95000 + index),
        name: 'Unrelated_' + index,
        definition: {
          ...structuredClone(template.definition),
          qualityRuleIds: [],
          maskPolicyIds: [],
          fields: template.definition.fields.map((field) => ({ ...field, maskPolicyId: '' })),
        },
      }))
      state.datasets = [
        ...unrelated,
        ...Array.from({ length: 121 }, (_, index) => ({
          ...structuredClone(template),
          id: String(96000 + index),
          name: 'Referenced_' + String(index).padStart(3, '0'),
          definition: {
            ...structuredClone(template.definition),
            qualityRuleIds: ['5001'],
            maskPolicyIds: index % 2 ? ['6001'] : [],
            fields: template.definition.fields.map((field, position) => ({
              ...field,
              maskPolicyId: index % 2 === 0 && position === 0 ? '6001' : '',
            })),
          },
        })),
      ]
    })
    for (const filter of ['qualityRuleId=5001', 'maskPolicyId=6001']) {
      const result = await request('/datasets?' + filter + '&sort=name&page=2&pageSize=100')
      expect(result.body.meta).toMatchObject({ page: 2, pageSize: 100, total: 121 })
      expect(result.body.data.map((dataset: { id: string }) => dataset.id)).toEqual(
        Array.from({ length: 21 }, (_, index) => String(96100 + index)),
      )
    }
    const intersection = await request(
      '/datasets?qualityRuleId=5001&maskPolicyId=6001&q=Referenced_12&sort=name',
    )
    expect(intersection.body.meta.total).toBe(1)
    expect(intersection.body.data[0].id).toBe('96120')
    expect((await request('/datasets?qualityRuleId=999999')).body.meta.total).toBe(0)
    expect((await request('/datasets?maskPolicyId=999999')).body.meta.total).toBe(0)
  })

  it('pages runs by recorded quality results and retains captured rule versions', async () => {
    await transact((state) => {
      state.tasks.forEach((task) => {
        task.schedule.mode = 'manual'
      })
      const template = structuredClone(state.runs[0]!)
      state.runs = Array.from({ length: 242 }, (_, index) => ({
        ...structuredClone(template),
        id: String(97000 + index),
        status: 'succeeded',
        retryAt: null,
        finishedAt: template.startedAt,
        qualityResults: [
          {
            ruleId: index < 121 ? '5002' : '5001',
            version: index < 121 ? 9 : 3,
            result: 'PASS',
            message: 'Captured quality result',
          },
        ],
      }))
      state.quality[0]!.version = 99
    })
    const result = await request('/runs?qualityRuleId=5001&page=2&pageSize=100')
    expect(result.body.meta).toMatchObject({ page: 2, pageSize: 100, total: 121 })
    expect(result.body.data.map((run: { id: string }) => run.id)).toEqual(
      Array.from({ length: 21 }, (_, index) => String(97221 + index)),
    )
    expect(
      result.body.data.every((run: { qualityResults: { version: number }[] }) =>
        run.qualityResults.every((quality) => quality.version === 3),
      ),
    ).toBe(true)
    const scoped = await request('/runs?qualityRuleId=5001&datasetId=999999')
    expect(scoped.body.meta.total).toBe(0)
    expect((await request('/runs?qualityRuleId=999999')).body.meta.total).toBe(0)
  })

  it('excludes task and dataset identities before pagination while preserving disabled dependencies', async () => {
    await transact((state) => {
      const template = structuredClone(state.tasks[0]!)
      state.tasks = Array.from({ length: 121 }, (_, index) => ({
        ...structuredClone(template),
        id: String(93000 + index),
        datasetId: String(94000 + index),
        name: 'Dependency_' + String(index).padStart(3, '0'),
        enabled: index % 2 === 0,
        schedule: { ...structuredClone(template.schedule), mode: 'manual', dependencies: [] },
      }))
    })
    const pages = []
    for (let page = 1; page <= 6; page++) {
      const result = await request(
        '/tasks?excludeId=93000&excludeDatasetId=94001&sort=name&pageSize=20&page=' + page,
      )
      expect(result.status).toBe(200)
      expect(result.body.meta).toMatchObject({ total: 119, page, pageSize: 20 })
      pages.push(...result.body.data)
    }
    expect(pages.map((task: { id: string }) => task.id)).toEqual(
      Array.from({ length: 119 }, (_, index) => String(93002 + index)),
    )
    expect(pages.some((task: { enabled: boolean }) => !task.enabled)).toBe(true)
    const last = await request('/tasks?excludeId=93000&excludeDatasetId=94001&pageSize=20&page=7')
    expect(last.body.data).toEqual([])
    expect(last.body.meta.total).toBe(119)
    const search = await request('/tasks?q=Dependency_12&excludeId=93120')
    expect(search.body.meta.total).toBe(0)
    expect(search.body.data).toEqual([])
    const paused = await request('/tasks?enabled=false&excludeId=93001')
    expect(paused.body.meta.total).toBe(59)
    expect(paused.body.data.every((task: { enabled: boolean }) => !task.enabled)).toBe(true)
    expect((await request('/tasks?excludeId=&excludeDatasetId=')).body.meta.total).toBe(121)
    expect((await request('/tasks')).body.meta.total).toBe(121)
    expect((await request('/tasks/93000')).body.data.id).toBe('93000')
  })

  it('filters published upstream candidates before pagination, excludes self and retains published drafts', async () => {
    await transact((state) => {
      const template = structuredClone(state.datasets[0]!)
      state.datasets = Array.from({ length: 121 }, (_, index) => ({
        ...structuredClone(template),
        id: String(91000 + index),
        name: 'Upstream_' + String(index).padStart(3, '0'),
        status: 'draft',
        publishedVersion: index % 3 === 0 ? 2 : 0,
        folderId: index % 2 === 0 ? null : template.folderId,
      }))
    })
    const expected = Array.from({ length: 40 }, (_, index) => String(91003 + index * 3))
    const first = await request(
      '/datasets?publishedOnly=true&excludeId=91000&pageSize=20&sort=name',
    )
    expect(first.status).toBe(200)
    expect(first.body.meta).toMatchObject({ total: 40, page: 1, pageSize: 20 })
    expect(first.body.data.map((dataset: { id: string }) => dataset.id)).toEqual(
      expected.slice(0, 20),
    )
    expect(
      first.body.data.every(
        (dataset: { status: string; publishedVersion: number }) =>
          dataset.status === 'draft' && dataset.publishedVersion === 2,
      ),
    ).toBe(true)
    const second = await request(
      '/datasets?publishedOnly=true&excludeId=91000&pageSize=20&page=2&sort=name',
    )
    expect(second.body.data.map((dataset: { id: string }) => dataset.id)).toEqual(
      expected.slice(20),
    )
    expect(second.body.meta.total).toBe(40)
    const last = await request('/datasets?publishedOnly=true&excludeId=91000&pageSize=20&page=3')
    expect(last.body.data).toEqual([])
    expect(last.body.meta.total).toBe(40)
    const search = await request(
      '/datasets?publishedOnly=true&excludeId=91120&q=Upstream_1&sort=name',
    )
    expect(search.body.data.map((dataset: { id: string }) => dataset.id)).toEqual([
      '91102',
      '91105',
      '91108',
      '91111',
      '91114',
      '91117',
    ])
    expect(search.body.meta.total).toBe(6)
    const unfiled = await request(
      '/datasets?publishedOnly=true&excludeId=91000&folderId=none&pageSize=100',
    )
    expect(unfiled.body.meta.total).toBe(20)
    expect(
      unfiled.body.data.every((dataset: { folderId: string | null }) => dataset.folderId === null),
    ).toBe(true)
    expect((await request('/datasets?publishedOnly=false')).body.meta.total).toBe(121)
    expect((await request('/datasets')).body.meta.total).toBe(121)
    expect((await request('/datasets?publishedOnly=invalid')).status).toBe(422)
  })

  it('aggregates all warehouse layers without truncating rows or counts to the first page', async () => {
    await transact((state) => {
      const template = structuredClone(state.tables[0]!)
      state.tables = Array.from({ length: 104 }, (_, index) => ({
        ...structuredClone(template),
        id: String(90000 + index),
        name: 'demo_metrics_' + index,
        layer: (['ODS', 'DWD', 'DWS', 'ADS'] as const)[index % 4]!,
        rowCount: index === 103 ? '9007199254740993' : '1',
      }))
    })
    const page = await request('/warehouse/tables?pageSize=100')
    expect(page.body.data).toHaveLength(100)
    expect(page.body.meta.total).toBe(104)
    const metrics = (await request('/warehouse/metrics')).body.data
    expect(metrics.tableCount).toBe(104)
    expect(metrics.rowCount).toBe('9007199254741096')
    expect(metrics.layers).toEqual([
      { layer: 'ODS', tableCount: 26, rowCount: '26' },
      { layer: 'DWD', tableCount: 26, rowCount: '26' },
      { layer: 'DWS', tableCount: 26, rowCount: '26' },
      { layer: 'ADS', tableCount: 26, rowCount: '9007199254741018' },
    ])
    const scoped = (await request('/warehouse/metrics?tableId=90103')).body.data
    expect(scoped.tableCount).toBe(1)
    expect(scoped.rowCount).toBe('9007199254740993')
    expect(scoped.layers).toEqual([
      { layer: 'ODS', tableCount: 0, rowCount: '0' },
      { layer: 'DWD', tableCount: 0, rowCount: '0' },
      { layer: 'DWS', tableCount: 0, rowCount: '0' },
      { layer: 'ADS', tableCount: 1, rowCount: '9007199254740993' },
    ])
    expect((await request('/warehouse/metrics?tableId=missing')).status).toBe(404)
    await transact((state) => {
      state.tables = []
    })
    const empty = (await request('/warehouse/metrics')).body.data
    expect(empty.tableCount).toBe(0)
    expect(empty.rowCount).toBe('0')
    expect(empty.layers).toEqual(
      ['ODS', 'DWD', 'DWS', 'ADS'].map((layer) => ({ layer, tableCount: 0, rowCount: '0' })),
    )
  })

  it('records mutation paths and related resources once without copying request payloads', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T00:00:00.000Z'))
    const before = (await readState()).audit.length
    const pause = '/tasks/3001/pause'
    expect(
      (await request(pause, 'POST', undefined, 'developer', 'audit-pause', '8005')).status,
    ).toBe(200)
    expect(
      (await request(pause, 'POST', undefined, 'developer', 'audit-pause', '8005')).status,
    ).toBe(200)
    expect(
      (await request('/tasks/3001/resume', 'POST', undefined, 'developer', undefined, '8005'))
        .status,
    ).toBe(200)
    const copy = await request(
      '/datasets/2001/copy',
      'POST',
      undefined,
      'developer',
      undefined,
      '8005',
    )
    expect(copy.status).toBe(201)
    expect((await request('/datasets/2001/versions/1/restore', 'POST')).status).toBe(200)
    expect((await request('/system/settings', 'PATCH', { timezone: 'UTC' })).status).toBe(200)
    expect(
      (await request('/sources/1001', 'PATCH', { description: 'private-payload-marker' })).status,
    ).toBe(200)
    const entries = (await readState()).audit.slice(0, -before)
    expect(entries).toHaveLength(6)
    expect(entries.filter((entry) => entry.detail.startsWith('POST /api/v1' + pause))).toEqual([
      expect.objectContaining({
        actor: '8005',
        action: 'post',
        resource: 'tasks',
        resourceId: '3001',
      }),
    ])
    expect(entries).toContainEqual(
      expect.objectContaining({
        actor: '8005',
        resourceId: '3001',
        detail: 'POST /api/v1/tasks/3001/resume → 3001',
      }),
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        actor: '8005',
        resourceId: '2001',
        detail: 'POST /api/v1/datasets/2001/copy → ' + copy.body.data.id,
      }),
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        resourceId: '2001',
        detail: 'POST /api/v1/datasets/2001/versions/1/restore → 2001',
      }),
    )
    expect(entries).toContainEqual(
      expect.objectContaining({
        actor: '8001',
        action: 'patch',
        resource: 'system',
        resourceId: 'settings',
        detail: 'PATCH /api/v1/system/settings',
      }),
    )
    expect(JSON.stringify(entries)).not.toContain('private-payload-marker')
    const auditCount = (await readState()).audit.length
    expect((await request('/sources/1001', 'DELETE')).status).toBe(409)
    expect((await request('/system/settings', 'PATCH', { timezone: 'invalid-zone' })).status).toBe(
      422,
    )
    expect((await request(pause, 'POST', undefined, 'viewer')).status).toBe(403)
    expect((await readState()).audit).toHaveLength(auditCount)
  }, 15000)

  it('audits a missing-table query as failed exactly once without a false success', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T00:00:00.000Z'))
    const table = (await readState()).tables[0]!
    const created = await request(
      '/queries',
      'POST',
      { sql: 'SELECT * FROM ' + table.name + ' LIMIT 100' },
      'viewer',
      undefined,
      '8003',
    )
    expect(created.status).toBe(201)
    const queryId = created.body.data.id
    await transact((state) => {
      state.tables = state.tables.filter((item) => item.id !== table.id)
    })
    expect((await request('/_test/clock', 'POST', { advanceSeconds: 3 })).status).toBe(200)
    expect(
      (await request('/queries/' + queryId, 'GET', undefined, 'viewer', undefined, '8003')).body
        .data.status,
    ).toBe('failed')
    await request('/_test/clock', 'POST', { advanceSeconds: 3 })
    const entries = (await readState()).audit.filter(
      (entry) => entry.resource === 'queries' && entry.resourceId === queryId,
    )
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor: '8003', action: 'post' }),
        expect.objectContaining({ actor: 'worker-demo', action: 'failed' }),
      ]),
    )
    expect(entries).toHaveLength(2)
    expect(entries.some((entry) => entry.action === 'succeeded')).toBe(false)
  })

  it('audits observed run stages once and keeps terminal failures separate from publication', async () => {
    const start = Date.parse('2026-10-16T00:00:00.000Z')
    vi.spyOn(Date, 'now').mockReturnValue(start)
    const created = await request('/datasets/2001/runs', 'POST', {})
    expect(created.status).toBe(201)
    const id = created.body.data.id
    for (const seconds of [2, 4, 6, 8])
      await transact((state) => {
        advanceRuns(state, start + seconds * 1000)
        advanceRuns(state, start + seconds * 1000)
      })
    const entries = (await readState()).audit.filter(
      (entry) => entry.resource === 'runs' && entry.resourceId === id,
    )
    expect(entries.map((entry) => entry.action)).toEqual([
      'succeeded',
      'publishing',
      'validating',
      'running',
    ])
    expect(entries.every((entry) => entry.actor === 'worker-demo')).toBe(true)
    testOutcomes.run = 'failed'
    const failed = await request('/datasets/2002/runs', 'POST', {})
    expect(failed.status).toBe(201)
    await transact((state) => {
      advanceRuns(state, start + 6000)
      advanceRuns(state, start + 8000)
    })
    const after = await readState()
    expect(after.audit.filter((entry) => entry.resourceId === failed.body.data.id)).toEqual([
      expect.objectContaining({ actor: 'worker-demo', action: 'failed', resource: 'runs' }),
    ])
    expect(
      after.audit.some(
        (entry) => entry.action === 'publish' && entry.detail.includes(failed.body.data.id),
      ),
    ).toBe(false)
  })

  it('audits import and export completion and expiry only once per transition', async () => {
    const start = Date.parse('2026-10-16T00:00:00.000Z')
    vi.spyOn(Date, 'now').mockReturnValue(start)
    for (const outcome of ['succeeded', 'failed'] as const) {
      testOutcomes.import = outcome
      const created = await request('/imports', 'POST', {
        name: 'audit-' + outcome,
        tableName: 'audit_' + outcome,
        layer: 'ODS',
        csv: 'id,value\n1,synthetic',
        mapping: [
          { source: 'id', target: 'id' },
          { source: 'value', target: 'value' },
        ],
      })
      expect(created.status).toBe(201)
      await transact((state) => {
        advanceTransfers(state, start + 1000)
        advanceTransfers(state, start + 1000)
        advanceTransfers(state, start + 3000)
        advanceTransfers(state, start + 4000)
      })
      const entries = (await readState()).audit.filter(
        (entry) => entry.resource === 'imports' && entry.resourceId === created.body.data.id,
      )
      expect(entries.map((entry) => entry.action)).toEqual([outcome, 'running', 'post'])
      expect(entries.map((entry) => entry.actor)).toEqual(['worker-demo', 'worker-demo', '8001'])
    }
    const table = (await readState()).tables[0]!
    const query = await request('/queries', 'POST', {
      sql: 'SELECT * FROM ' + table.name + ' LIMIT 100',
    })
    expect(query.status).toBe(201)
    await transact((state) => advanceQueries(state, start + 3000))
    for (const outcome of ['ready', 'failed'] as const) {
      testOutcomes.export = outcome
      const created = await request('/exports', 'POST', {
        queryId: query.body.data.id,
        format: 'csv',
      })
      expect(created.status).toBe(201)
      await transact((state) => {
        advanceTransfers(state, start + 2000)
        advanceTransfers(state, start + 2000)
        advanceTransfers(state, start + 86400001)
        advanceTransfers(state, start + 86400002)
      })
      const entries = (await readState()).audit.filter(
        (entry) => entry.resource === 'exports' && entry.resourceId === created.body.data.id,
      )
      expect(entries.map((entry) => entry.action)).toEqual(
        outcome === 'ready' ? ['expired', 'ready', 'post'] : ['failed', 'post'],
      )
      expect(
        entries
          .filter((entry) => entry.action !== 'post')
          .every((entry) => entry.actor === 'worker-demo'),
      ).toBe(true)
    }
  }, 10000)

  it.each(['append', 'replace', 'upsert'] as const)(
    'publishes %s output through HTTP and audits the human and worker separately',
    async (writeMode) => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T00:00:00.000Z'))
      const initial = await readState()
      const dataset = structuredClone(initial.datasets[0]!)
      const table = initial.tables.find((item) => item.name === dataset.definition.output.table)!
      expect(table).toBeTruthy()
      const previousCount = table.sample.length
      dataset.definition.output.writeMode = writeMode
      dataset.definition.schedule = { ...dataset.definition.schedule, mode: 'manual', retries: 0 }
      expect(
        (await request('/datasets/' + dataset.id, 'PATCH', { definition: dataset.definition }))
          .status,
      ).toBe(200)
      const published = await request('/datasets/' + dataset.id + '/publish', 'POST')
      expect(published.status).toBe(200)
      const version = published.body.data.version
      const created = await request(
        '/datasets/' + dataset.id + '/runs',
        'POST',
        {},
        'admin',
        'write-mode-run',
      )
      expect(created.status).toBe(201)
      const runId = created.body.data.id
      const repeated = await request(
        '/datasets/' + dataset.id + '/runs',
        'POST',
        {},
        'admin',
        'write-mode-run',
      )
      expect(repeated.body.data.id).toBe(runId)
      await request('/_test/clock', 'POST', { advanceSeconds: 8 })
      const run = (await request('/runs/' + runId)).body.data
      expect(run).toMatchObject({
        status: 'succeeded',
        datasetVersion: version,
        outputTableId: table.id,
      })
      const after = await readState()
      const output = after.tables.find((item) => item.id === table.id)!
      const expectedCount =
        writeMode === 'append' ? previousCount + Number(run.rowCount) : Number(run.rowCount)
      expect(output.sample).toHaveLength(expectedCount)
      expect(output.rowCount).toBe(String(expectedCount))
      expect(output.datasetVersion).toBe(version)
      expect(after.tasks.find((task) => task.id === run.taskId)?.lastSuccessRunId).toBe(runId)
      expect(
        after.audit.filter(
          (audit) =>
            audit.actor === '8001' &&
            audit.action === 'post' &&
            audit.resource === 'datasets' &&
            audit.resourceId === dataset.id,
        ),
      ).toHaveLength(2)
      expect(
        after.audit.filter(
          (audit) =>
            audit.actor === 'worker-demo' &&
            audit.action === 'succeeded' &&
            audit.resource === 'runs' &&
            audit.resourceId === runId,
        ),
      ).toHaveLength(1)
      expect(
        after.audit.filter(
          (audit) =>
            audit.actor === 'worker-demo' &&
            audit.action === 'publish' &&
            audit.resource === 'warehouse' &&
            audit.resourceId === table.id,
        ),
      ).toHaveLength(1)
    },
  )

  it.each([
    ['QuotaExceededError', 'STORAGE_FULL'],
    ['InvalidStateError', 'STORAGE_UNAVAILABLE'],
  ])(
    'rolls back a failed %s write and retries the same request without duplicates',
    async (name, code) => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T00:00:00.000Z'))
      const before = await readState()
      const {
        id: _id,
        status: _status,
        objectCount: _count,
        updatedAt: _updated,
        ...input
      } = before.sources[0]!
      input.name = '存储回滚与恢复'
      const original = IDBObjectStore.prototype.put
      const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function () {
        // Reproduce an engine that has already aborted before the caller handles its failure.
        this.transaction.abort()
        throw new DOMException('Synthetic storage failure', name)
      })
      const failed = await request('/sources', 'POST', input, 'admin', 'storage-retry')
      put.mockRestore()
      expect(failed.status).toBe(500)
      expect(failed.body.error).toMatchObject({ code, details: [], requestId: expect.any(String) })
      expect(await readState()).toEqual(before)

      const saved = await request('/sources', 'POST', input, 'admin', 'storage-retry')
      expect(saved.status).toBe(201)
      const repeated = await request('/sources', 'POST', input, 'admin', 'storage-retry')
      expect(repeated.body.data.id).toBe(saved.body.data.id)
      const after = await readState()
      expect(after.sources.filter((source) => source.name === input.name)).toHaveLength(1)
      expect(after.objects.filter((object) => object.sourceId === saved.body.data.id)).toHaveLength(
        1,
      )
      expect(after.audit.filter((audit) => audit.resourceId === saved.body.data.id)).toHaveLength(1)
      expect(IDBObjectStore.prototype.put).toBe(original)
    },
  )

  it('rolls back resources and audit when the transaction aborts after a successful put request', async () => {
    const before = await readState()
    const original = IDBObjectStore.prototype.put
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementationOnce(function (value, key) {
        const request = original.call(this, value, key)
        request.addEventListener('success', () => this.transaction.abort(), { once: true })
        return request
      })
    const failed = await request('/sources/1001', 'PATCH', { name: '不应落盘的修改' })
    put.mockRestore()
    expect(failed.status).toBe(500)
    expect(failed.body.error.code).toBe('STORAGE_UNAVAILABLE')
    expect(await readState()).toEqual(before)
    expect((await request('/sources/1001', 'PATCH', { name: '恢复后保存' })).status).toBe(200)
    expect((await readState()).sources.find((source) => source.id === '1001')?.name).toBe(
      '恢复后保存',
    )
  })

  it('rejects malformed or oversized UTF-8 CSV imports without creating tasks or tables', async () => {
    const before = await readState()
    const input = {
      name: '虚构 CSV 边界',
      tableName: 'ods_csv_boundaries',
      layer: 'ODS',
      csv: 'id,name\n1,demo',
      mapping: [
        { source: 'id', target: 'id' },
        { source: 'name', target: 'name' },
      ],
    }
    for (const patch of [
      { csv: 'id,name\n1,de"mo' },
      { csv: 'id,name\n1,"demo"suffix' },
      { csv: 'id,name\n1,' + '演'.repeat(340000) },
      {
        mapping: [
          { source: 'id', target: 'id' },
          { source: 'name', target: ' id ' },
        ],
      },
    ]) {
      expect((await request('/imports', 'POST', { ...input, ...patch })).status).toBe(422)
    }
    const after = await readState()
    expect(after.imports).toEqual(before.imports)
    expect(after.tables).toEqual(before.tables)
    expect(after.pendingImports).toEqual(before.pendingImports)
  })

  it('uses the advanced demo clock for queries, transfers, expiration and quality samples', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T00:00:00.000Z'))
    await request('/_test/clock', 'POST', { advanceSeconds: 3600 })
    const table = (await request('/warehouse/tables/4001')).body.data
    const query = (
      await request('/queries', 'POST', { sql: 'SELECT * FROM ' + table.name + ' LIMIT 100' })
    ).body.data
    const imported = (
      await request('/imports', 'POST', {
        name: '演示时钟回归',
        tableName: 'ods_demo_clock',
        layer: 'ODS',
        csv: 'id,name\n1,clock',
        mapping: [
          { source: 'id', target: 'id' },
          { source: 'name', target: 'name' },
        ],
      })
    ).body.data
    await request('/_test/clock', 'POST', { advanceSeconds: 3 })
    const advanced = await readState()
    expect(advanced.queries.find((item) => item.id === query.id)?.status).toBe('succeeded')
    expect(advanced.imports.find((item) => item.id === imported.id)?.status).toBe('succeeded')
    expect((await request('/queries/' + query.id)).body.data.status).toBe('succeeded')
    expect(
      (await request('/imports')).body.data.find((item: { id: string }) => item.id === imported.id),
    ).toMatchObject({ status: 'succeeded', progress: 100 })
    const exported = (await request('/exports', 'POST', { queryId: query.id, format: 'csv' })).body
      .data
    await request('/_test/clock', 'POST', { advanceSeconds: 2 })
    expect((await request('/exports/' + exported.id)).body.data).toMatchObject({
      status: 'ready',
      progress: 100,
    })
    const clock = (await request('/_test/clock', 'POST', { advanceSeconds: 86400 })).body.data
    expect((await readState()).exports.find((item) => item.id === exported.id)).toMatchObject({
      status: 'expired',
      content: '',
    })
    expect((await request('/exports/' + exported.id)).body.data).toMatchObject({
      status: 'expired',
      content: '',
    })
    expect((await request('/warehouse/metrics')).body.data.trend.at(-1).date).toBe(
      clock.now.slice(0, 10),
    )
    expect((await request('/overview')).body.data.trend.at(-1).date).toBe(clock.now.slice(0, 10))
  })

  it('advances the isolated test clock without accumulating idempotency entries', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T00:00:00.000Z'))
    const first = await request('/_test/clock', 'POST', { advanceSeconds: 10 })
    const second = await request('/_test/clock', 'POST', { advanceSeconds: 10 })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.data.changed).toBeTypeOf('boolean')
    expect(Date.parse(second.body.data.now) - Date.parse(first.body.data.now)).toBe(10000)
    expect((await readState()).idempotency).toEqual({})
    expect((await request('/_test/clock', 'POST', { advanceSeconds: 86401 })).status).toBe(422)
  })

  it('isolates catalog favorites by user and preserves old shared favorites only for the demo administrator', async () => {
    await request(
      '/governance/catalog/source-1001/favorite',
      'POST',
      { favorite: true },
      'viewer',
      undefined,
      '8003',
    )
    const own = await request(
      '/governance/catalog?favorite=true',
      'GET',
      undefined,
      'viewer',
      undefined,
      '8003',
    )
    expect(own.body.data.map((item: { id: string }) => item.id)).toEqual(['source-1001'])
    expect(
      (
        await request(
          '/governance/catalog?favorite=true',
          'GET',
          undefined,
          'viewer',
          undefined,
          '8006',
        )
      ).body.data,
    ).toEqual([])
    await request(
      '/governance/catalog/source-1001/favorite',
      'POST',
      { favorite: false },
      'viewer',
      undefined,
      '8006',
    )
    expect(
      (
        await request(
          '/governance/catalog?favorite=true',
          'GET',
          undefined,
          'viewer',
          undefined,
          '8003',
        )
      ).body.data,
    ).toHaveLength(1)
    await transact((state) => {
      Reflect.deleteProperty(state, 'favoritesByUser')
      state.favorites = ['dataset-2001']
    })
    expect(
      (
        await request(
          '/governance/catalog?favorite=true',
          'GET',
          undefined,
          'admin',
          undefined,
          '8001',
        )
      ).body.data.map((item: { id: string }) => item.id),
    ).toEqual(['dataset-2001'])
    expect(
      (
        await request(
          '/governance/catalog?favorite=true',
          'GET',
          undefined,
          'admin',
          undefined,
          '8004',
        )
      ).body.data,
    ).toEqual([])
    expect((await readState()).favorites).toBeUndefined()
  })
  it('captures all source inputs on publication and protects historical dependencies after source metadata changes', async () => {
    const definition = structuredClone((await readState()).datasets[0]!.definition)
    definition.nodes.push(
      { id: 'right', type: 'input', label: 'right', x: 0, y: 200, config: '11003' },
      { id: 'join', type: 'join', label: 'join', x: 600, y: 0, config: 'left:id=id' },
    )
    definition.edges.push(
      { id: 'left-join', source: 'fields', target: 'join' },
      { id: 'right-join', source: 'right', target: 'join' },
    )
    await request('/datasets/2001', 'PATCH', { definition })
    const published = await request('/datasets/2001/publish', 'POST')
    expect(published.status).toBe(200)
    expect(
      published.body.data.sourceSnapshots.map(
        (snapshot: { object: { id: string } }) => snapshot.object.id,
      ),
    ).toEqual(['11001', '11003'])
    expect(published.body.data.sourceSnapshotOrigin).toBe('published')
    expect(published.body.data.sourceSnapshotCapturedAt).toBe(published.body.data.createdAt)
    await transact((state) => {
      state.datasets = state.datasets.filter((dataset) => dataset.id === '2001')
      state.datasets[0]!.definition.nodes = state.datasets[0]!.definition.nodes.filter(
        (node) => !['right', 'join'].includes(node.id),
      )
      state.datasets[0]!.definition.edges = [
        { id: 'input-fields', source: 'input', target: 'fields' },
      ]
      state.versions = state.versions.filter((version) => version.datasetId === '2001')
      state.objects = state.objects.filter((object) => object.sourceId !== '1002')
      state.objects[0]!.fields = []
    })
    const reread = await request('/datasets/2001/versions/2')
    expect(reread.body.data).toEqual(published.body.data)
    const removed = await request('/sources/1002', 'DELETE')
    expect(removed.status).toBe(409)
    expect(removed.body.error.code).toBe('DEPENDENCY_CONFLICT')
  })
  it('labels legacy schema migration honestly and never recaptures already migrated versions', async () => {
    await transact((state) => {
      const version = state.versions[0]!
      Reflect.deleteProperty(version, 'sourceSnapshots')
      Reflect.deleteProperty(version, 'sourceSnapshotOrigin')
      Reflect.deleteProperty(version, 'sourceSnapshotCapturedAt')
      state.sources[0]!.name = '迁移时的源名称'
    })
    const migrated = (await request('/datasets/2001/versions/1')).body.data
    expect(migrated.sourceSnapshotOrigin).toBe('migrated')
    expect(migrated.sourceSnapshots[0].sourceName).toBe('迁移时的源名称')
    expect(migrated.sourceSnapshotCapturedAt).not.toBe(migrated.createdAt)
    await transact((state) => {
      state.sources[0]!.name = '之后再次修改'
    })
    expect((await request('/datasets/2001/versions/1')).body.data).toEqual(migrated)
  })
  it('manages folder hierarchy and moves datasets without changing published definitions', async () => {
    const published = (await readState()).versions.filter((version) => version.datasetId === '2001')
    const parent = (await request('/dataset-folders', 'POST', { name: '组织目录', parentId: null }))
      .body.data
    const child = (
      await request('/dataset-folders', 'POST', { name: '子目录', parentId: parent.id })
    ).body.data
    expect(
      (await request('/dataset-folders', 'POST', { name: ' 子目录 ', parentId: parent.id })).status,
    ).toBe(409)
    expect(
      (await request('/dataset-folders/' + parent.id, 'PATCH', { parentId: child.id })).status,
    ).toBe(422)
    expect(
      (await request('/dataset-folders/' + child.id, 'PATCH', { parentId: child.id })).status,
    ).toBe(422)
    expect(
      (await request('/dataset-folders/' + child.id, 'PATCH', { parentId: '999999' })).status,
    ).toBe(404)
    const moved = await request('/datasets/2001', 'PATCH', { folderId: child.id })
    expect(moved.body.data.status).toBe('published')
    expect(moved.body.data.publishedVersion).toBe(1)
    const list = await request('/datasets?folderId=' + parent.id)
    expect(list.body.data.map((dataset: { id: string }) => dataset.id)).toEqual(['2001'])
    expect((await request('/dataset-folders/' + child.id, 'DELETE')).status).toBe(409)
    expect((await request('/dataset-folders/' + parent.id, 'DELETE')).status).toBe(409)
    expect((await request('/datasets/2001', 'PATCH', { folderId: '999999' })).status).toBe(404)
    expect(
      (await request('/dataset-folders/' + child.id, 'PATCH', { name: '只读修改' }, 'viewer'))
        .status,
    ).toBe(403)
    expect(
      (await request('/dataset-folders', 'POST', { name: '只读新建', parentId: null }, 'viewer'))
        .status,
    ).toBe(403)
    const renamed = (await request('/dataset-folders/' + child.id, 'PATCH', { name: '已重命名' }))
      .body.data
    expect(renamed.parentId).toBe(parent.id)
    const movedOut = (await request('/datasets/2001', 'PATCH', { folderId: null })).body.data
    expect(movedOut.folderId).toBeNull()
    expect(movedOut.status).toBe('published')
    expect(
      (await request('/datasets?folderId=none')).body.data.some(
        (dataset: { id: string }) => dataset.id === '2001',
      ),
    ).toBe(true)
    expect((await request('/dataset-folders/' + child.id, 'DELETE')).status).toBe(200)
    expect((await request('/dataset-folders/' + parent.id, 'DELETE')).status).toBe(200)
    expect((await readState()).versions.filter((version) => version.datasetId === '2001')).toEqual(
      published,
    )
    expect(
      (await readState()).audit.some(
        (entry) =>
          entry.resource === 'dataset-folders' &&
          entry.actor === '8001' &&
          entry.action === 'delete',
      ),
    ).toBe(true)
  })
  it('publishes the bound version subject domain and filters it independently of layer', async () => {
    const input = structuredClone((await readState()).datasets[0]!.definition)
    input.output.subjectDomain = '售后'
    input.output.table = 'dwd_domain_case'
    await request('/datasets/2001', 'PATCH', { definition: input })
    await request('/datasets/2001/publish', 'POST')
    const at = Date.parse('2026-10-16T05:00:00Z')
    const run = await transact((state) =>
      createRun(state, '2001', 'succeeded', 'manual', new Date(at).toISOString()),
    )
    input.output.subjectDomain = '未发布改动'
    await request('/datasets/2001', 'PATCH', { definition: input })
    await transact((state) => advanceRuns(state, at + 8000))
    const stored = await readState()
    const table = stored.tables.find(
      (table) => table.id === stored.runs.find((entry) => entry.id === run.id)?.outputTableId,
    )
    expect(table?.subjectDomain).toBe('售后')
    expect((await request('/warehouse/subject-domains')).body.data).toContain('售后')
    const filtered = await request(
      '/warehouse/tables?subjectDomain=' + encodeURIComponent('售后') + '&layer=DWD',
    )
    expect(filtered.body.data.map((table: { name: string }) => table.name)).toEqual([
      'dwd_domain_case',
    ])
    expect(
      (
        await request(
          '/warehouse/tables?subjectDomain=' + encodeURIComponent('售后') + '&layer=ODS',
        )
      ).body.data,
    ).toEqual([])
    expect(
      (await request('/warehouse/tables?subjectDomain=' + encodeURIComponent('未发布改动'))).body
        .data,
    ).toEqual([])
  })
  it('uses one column policy across table, query, service and export, with private ownership', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T00:00:00Z'))
    const source = (await request('/sources/1001/preview', 'POST', { objectId: '11001' }, 'viewer'))
      .body.data
    expect(source.fields.map((field: { name: string }) => field.name)).not.toContain('phone')
    expect(source.rows[0]).not.toHaveProperty('phone')
    const definition = (await readState()).datasets[0]!.definition
    for (const path of ['/datasets/2001/preview', '/datasets/preview']) {
      const body =
        path === '/datasets/preview'
          ? { ...(await readState()).datasets[0], definition }
          : undefined
      if (body) {
        Reflect.deleteProperty(body, 'id')
        Reflect.deleteProperty(body, 'updatedAt')
        Reflect.deleteProperty(body, 'status')
        Reflect.deleteProperty(body, 'publishedVersion')
      }
      const preview = await request(path, 'POST', body, 'viewer')
      expect(preview.status).toBe(200)
      expect(
        preview.body.data.fields.map((field: { target: string }) => field.target),
      ).not.toContain('phone')
      expect(preview.body.data.rows[0]).not.toHaveProperty('phone')
    }
    const table = (await request('/warehouse/tables/4001', 'GET', undefined, 'viewer')).body.data
    expect(table.fields.some((field: { target: string }) => field.target === 'phone')).toBe(false)
    expect(table.sample[0]).not.toHaveProperty('phone')
    const input = { sql: 'SELECT * FROM ' + table.name + ' LIMIT 100' }
    const one = (await request('/queries', 'POST', input, 'developer', 'same-key', '8002')).body
      .data
    const two = (await request('/queries', 'POST', input, 'developer', 'same-key', '8005')).body
      .data
    expect(one.id).not.toBe(two.id)
    expect(one.columns).toContain('phone')
    expect(
      (await request('/queries/' + one.id, 'GET', undefined, 'developer', undefined, '8005'))
        .status,
    ).toBe(403)
    expect(
      (await request('/queries', 'GET', undefined, 'developer', undefined, '8005')).body.data.map(
        (query: { id: string }) => query.id,
      ),
    ).toEqual([two.id])
    await transact((state) => advanceQueries(state, Date.now() + 3000))
    const output = (
      await request(
        '/exports',
        'POST',
        { queryId: one.id, format: 'csv' },
        'developer',
        undefined,
        '8002',
      )
    ).body.data
    expect(output.content).toBe('')
    await transact((state) => advanceTransfers(state, Date.now() + 2000))
    expect(
      (await request('/exports/' + output.id, 'GET', undefined, 'developer', undefined, '8002'))
        .body.data.content,
    ).toContain('phone')
    expect(
      (await request('/exports/' + output.id, 'GET', undefined, 'developer', undefined, '8005'))
        .status,
    ).toBe(403)
    expect(
      (await request('/exports', 'GET', undefined, 'developer', undefined, '8005')).body.data,
    ).toEqual([])
    await request('/system/roles/developer', 'PATCH', { permissions: ['read', 'write'] })
    expect(
      (await request('/queries/' + one.id, 'GET', undefined, 'developer', undefined, '8002')).body
        .data.rows[0],
    ).not.toHaveProperty('phone')
    expect(
      (await request('/exports/' + output.id, 'GET', undefined, 'developer', undefined, '8002'))
        .body.data,
    ).toMatchObject({ status: 'failed', content: '' })
    const viewer = (await request('/queries', 'POST', input, 'viewer', undefined, '8003')).body.data
    await transact((state) => advanceQueries(state, Date.now() + 3000))
    const viewerExport = (
      await request(
        '/exports',
        'POST',
        { queryId: viewer.id, format: 'csv' },
        'viewer',
        undefined,
        '8003',
      )
    ).body.data
    await transact((state) => advanceTransfers(state, Date.now() + 2000))
    const downloaded = (
      await request('/exports/' + viewerExport.id, 'GET', undefined, 'viewer', undefined, '8003')
    ).body.data
    expect(downloaded.status).toBe('ready')
    expect(downloaded.content).not.toContain('phone')
    expect(
      (await request('/services/7001/call', 'POST', { parameters: {} }, 'viewer')).body.data[0],
    ).not.toHaveProperty('phone')
    const audit = (await readState()).audit
    expect(
      audit.find(
        (entry) =>
          entry.resource === 'queries' && entry.resourceId === one.id && entry.action === 'post',
      )?.actor,
    ).toBe('8002')
  }, 15000)
  it('preserves API configuration while redacting known credential fields and hashing idempotency inputs', async () => {
    const source = (await request('/sources/1007')).body.data
    const settings = {
      ...source.settings,
      method: 'POST',
      pagination: 'cursor',
      headers: JSON.stringify({
        Accept: 'application/json',
        Authorization: 'Bearer synthetic-credential-for-test',
      }),
      query: JSON.stringify({ page: 0, enabled: false, cursor: null, search: '' }),
      body: JSON.stringify({
        filter: { city: '杭州', token: 'synthetic-credential-for-test' },
        ids: ['100', '101'],
      }),
    }
    const saved = await request(
      '/sources/1007',
      'PATCH',
      { settings },
      'developer',
      'source-configuration',
    )
    expect(saved.status).toBe(200)
    expect(JSON.parse(saved.body.data.settings.headers)).toEqual({
      Accept: 'application/json',
      Authorization: '[REDACTED]',
    })
    expect(JSON.parse(saved.body.data.settings.query)).toEqual({
      page: 0,
      enabled: false,
      cursor: null,
      search: '',
    })
    expect(JSON.parse(saved.body.data.settings.body)).toEqual({
      filter: { city: '杭州', token: '[REDACTED]' },
      ids: ['100', '101'],
    })
    expect((await request('/sources/1007')).body.data.settings).toEqual(saved.body.data.settings)
    expect(JSON.stringify(await readState())).not.toContain('synthetic-credential-for-test')
    const repeated = await request(
      '/sources/1007',
      'PATCH',
      { settings },
      'developer',
      'source-configuration',
    )
    expect(repeated.body.data).toEqual(saved.body.data)
    expect(
      (await request('/sources/1007', 'PATCH', { settings: { ...settings, query: '[]' } })).status,
    ).toBe(422)
    expect(
      (await request('/sources/1007', 'PATCH', { settings: { ...settings, baseUrl: 'https://' } }))
        .status,
    ).toBe(422)
    expect((await request('/sources/1007')).body.data.settings).toEqual(saved.body.data.settings)
  })
  it('keeps task schedules independent from dataset drafts and checks dependency cycles', async () => {
    const task = (await request('/tasks/3001')).body.data
    for (const changes of [
      { cron: '99 9 * * *' },
      { timezone: 'Not/AZone' },
      { retries: 11 },
      { concurrency: 1.5 },
      { dependencies: ['3001'] },
      { dependencies: ['999999'] },
    ]) {
      expect(
        (await request('/tasks/3001', 'PATCH', { schedule: { ...task.schedule, ...changes } }))
          .status,
      ).toBe(422)
    }
    expect((await request('/tasks/3001')).body.data.schedule).toEqual(task.schedule)
    expect(
      (
        await request('/tasks/3001', 'PATCH', {
          schedule: { ...task.schedule, dependencies: ['3002'] },
        })
      ).status,
    ).toBe(200)
    const second = (await request('/tasks/3002')).body.data
    expect(
      (
        await request('/tasks/3002', 'PATCH', {
          schedule: { ...second.schedule, dependencies: ['3001'] },
        })
      ).status,
    ).toBe(422)
    expect((await request('/datasets/2001')).body.data.definition.schedule.dependencies).toEqual([])
    expect(
      (await request('/datasets/2001/versions/1')).body.data.definition.schedule.dependencies,
    ).toEqual([])
  }, 10000)
  it('creates dated backfills once, preserves queue state and keeps the date on retry', async () => {
    const input = { from: '2026-10-13', to: '2026-10-15' }
    const result = await request(
      '/tasks/3001/backfills',
      'POST',
      input,
      'developer',
      'dated-backfill',
    )
    expect(result.status).toBe(201)
    expect(result.body.data.map((run: { businessDate: string }) => run.businessDate)).toEqual([
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ])
    expect(result.body.data[1]).toMatchObject({
      waitReason: 'concurrency',
      executionStartedAt: null,
      qualityResults: [],
    })
    const again = await request(
      '/tasks/3001/backfills',
      'POST',
      input,
      'developer',
      'dated-backfill',
    )
    expect(again.body.data).toEqual(result.body.data)
    const audits = (await readState()).audit.filter((entry) =>
      entry.detail.startsWith('POST /api/v1/tasks/3001/backfills'),
    )
    expect(audits).toEqual([
      expect.objectContaining({ actor: '8002', resource: 'tasks', resourceId: '3001' }),
    ])
    for (const run of result.body.data) expect(audits[0]!.detail).toContain(run.id)
    expect((await request('/runs?trigger=backfill&taskId=3001')).body.meta.total).toBe(3)
    const queued = result.body.data[1]
    await request('/runs/' + queued.id + '/cancel', 'POST')
    const retry = await request('/runs/' + queued.id + '/retry', 'POST', {})
    expect(retry.body.data).toMatchObject({
      retryOf: queued.id,
      businessDate: queued.businessDate,
      scheduleSnapshot: queued.scheduleSnapshot,
      datasetVersion: queued.datasetVersion,
    })
    for (const dates of [
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-10-15', to: '2026-10-13' },
      { from: '2026-01-01', to: '2026-10-15' },
    ])
      expect((await request('/tasks/3001/backfills', 'POST', { ...dates })).status).toBe(422)
  }, 10000)
  it('rejects invalid masking parameters without changing the saved policy', async () => {
    const original = (await request('/governance/masking/6001')).body.data
    expect((await request('/governance/masking/6001', 'PATCH', { parameter: '-1,4' })).status).toBe(
      422,
    )
    expect((await request('/governance/masking/6001')).body.data.version).toBe(original.version)
    expect((await request('/governance/masking/6003', 'PATCH', { parameter: ' ' })).status).toBe(
      422,
    )
  })
  it('rejects disabled demo identities and preserves the current administrator', async () => {
    expect((await request('/_test/users')).body.data).toHaveLength(6)
    expect((await request('/system/users/8001', 'PATCH', { enabled: false })).status).toBe(409)
    expect((await request('/system/users/8001', 'DELETE')).status).toBe(409)
    expect((await request('/system/users/8001', 'PATCH', { role: 'viewer' })).status).toBe(409)
    expect((await request('/system/users/8002', 'PATCH', { enabled: false })).status).toBe(200)
    const response = await fetch('http://localhost/api/v1/session', {
      headers: { 'x-demo-role': 'developer', 'x-demo-user': '8002' },
    })
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
    expect((await request('/session', 'GET', undefined, 'developer')).body.data.user.id).toBe(
      '8005',
    )
  })
  it('rejects invalid quality rule parameters without changing the saved rule', async () => {
    expect((await request('/governance/quality/5003', 'PATCH', { parameter: '10,1' })).status).toBe(
      422,
    )
    expect((await request('/governance/quality/5003')).body.data.parameter).toBe('0,100000')
  })
  it('validates the resource list and detail response shapes', async () => {
    for (const path of [
      '/sources',
      '/sources/1001',
      '/datasets',
      '/datasets/2001',
      '/datasets/2001/versions/1',
      '/tasks',
      '/tasks/3001',
      '/runs',
      '/runs/9001',
      '/warehouse/tables',
      '/warehouse/tables/4001',
      '/warehouse/metrics',
      '/governance/quality',
      '/governance/masking',
      '/governance/catalog',
      '/governance/lineage',
      '/governance/lineage?scope=field',
      '/services',
      '/services/7001',
      '/services/7001/audit',
      '/system/users',
      '/system/roles',
      '/system/settings',
      '/system/audit',
      '/overview',
    ]) {
      expect((await request(path)).status, path).toBe(200)
    }
  }, 15000)
  it('PATCH preserves omitted values and explicit false, zero and empty values', async () => {
    const before = (await request('/system/settings')).body.data
    expect((await request('/system/settings', 'PATCH', { notifications: true })).status).toBe(200)
    const updated = await request('/system/settings', 'PATCH', { notifications: false })
    expect(updated.body.data).toEqual({ ...before, notifications: false })
    const source = await request('/sources/1001', 'PATCH', { description: '' })
    expect(source.body.data.description).toBe('')
    expect(source.body.data.name).toBe('零售订单库')
    const task = (await request('/tasks/3001')).body.data
    const changed = await request('/tasks/3001', 'PATCH', {
      schedule: { ...task.schedule, retries: 0 },
    })
    expect(changed.body.data.schedule.retries).toBe(0)
    expect((await request('/sources/1001', 'PATCH', { name: null })).status).toBe(422)
  })
  it('writes idempotently and returns explicit errors without corrupting state', async () => {
    const first = await request('/datasets/2001/copy', 'POST', undefined, 'developer', 'copy-once')
    const repeated = await request(
      '/datasets/2001/copy',
      'POST',
      undefined,
      'developer',
      'copy-once',
    )
    expect(repeated.body.data.id).toBe(first.body.data.id)
    expect((await readState()).datasets).toHaveLength(16)
    expect((await request('/sources/1001', 'DELETE')).status).toBe(409)
    expect((await request('/sources/999999')).status).toBe(404)
    expect((await request('/datasets/2001/copy', 'POST', undefined, 'viewer')).status).toBe(403)
    expect((await request('/system/users', 'GET', undefined, 'developer')).status).toBe(403)
  })
  it('rejects invalid service calls and calls after disabling', async () => {
    expect(
      (await request('/services/7001/call', 'POST', { parameters: { unknown: 'x' } })).status,
    ).toBe(400)
    const called = await request('/services/7001/call', 'POST', { parameters: { city: '杭州' } })
    expect(called.body.data).toHaveLength(4)
    await request('/services/7001/disable', 'POST')
    expect((await request('/services/7001/call', 'POST', { parameters: {} })).status).toBe(409)
  })
  it('preserves hidden service definitions on metadata edits and rejects restricted replacement atomically', async () => {
    await transact((state) => {
      state.roles.find((role) => role.id === 'developer')!.permissions = ['read', 'write']
      const service = state.services[0]!
      service.fields.push('phone')
      service.parameters.push({ name: 'phone', type: 'string', required: true })
      service.sortField = 'phone'
    })
    const original = (await readState()).services[0]!
    const limited = (await request('/services/7001', 'GET', undefined, 'developer')).body.data
    expect(limited.definitionRestricted).toBe(true)
    expect(limited.fields).not.toContain('phone')
    expect(
      limited.parameters.some((parameter: { name: string }) => parameter.name === 'phone'),
    ).toBe(false)
    expect(limited.sortField).toBe('')
    const list = (await request('/services', 'GET', undefined, 'developer')).body.data
    expect(list.find((service: { id: string }) => service.id === '7001')).toEqual(limited)
    const metadata = await request(
      '/services/7001',
      'PATCH',
      { name: '受限元数据更新', description: '', pageSize: 5 },
      'developer',
    )
    expect(metadata.status).toBe(200)
    expect(metadata.body.data.definitionRestricted).toBe(true)
    expect(metadata.body.data.fields).not.toContain('phone')
    const replaced = await request(
      '/services/7001',
      'PATCH',
      { fields: limited.fields, parameters: limited.parameters, sortField: '' },
      'developer',
    )
    expect(replaced.status).toBe(403)
    const stored = (await readState()).services[0]!
    expect(stored.fields).toEqual(original.fields)
    expect(stored.parameters).toEqual(original.parameters)
    expect(stored.sortField).toBe('phone')
    expect(stored.name).toBe('受限元数据更新')
    expect(
      (await request('/services/7001/call', 'POST', { parameters: {} }, 'developer')).status,
    ).toBe(403)
    const toggled = await request('/services/7001/disable', 'POST', undefined, 'developer')
    expect(toggled.body.data.fields).not.toContain('phone')
    expect(
      (
        await request(
          '/services/7001',
          'PATCH',
          { fields: ['id'], parameters: [], sortField: '' },
          'admin',
        )
      ).status,
    ).toBe(200)
    await request('/services/7001', 'PATCH', { allowedRoles: ['admin'] }, 'admin')
    expect(
      (await request('/services/7001', 'PATCH', { name: '越权修改' }, 'developer')).status,
    ).toBe(403)
    expect((await request('/services/7001/enable', 'POST', undefined, 'developer')).status).toBe(
      403,
    )
    expect((await request('/services/7001', 'DELETE', undefined, 'developer')).status).toBe(403)
  })
})

it.each(['/queries', '/imports', '/exports'])(
  'warehouse control applies error, forbidden and empty scenarios to %s',
  async (path) => {
    for (const [scenario, status] of [
      ['error', 500],
      ['forbidden', 403],
      ['empty', 200],
    ] as const) {
      expect(
        (await request('/_test/control', 'PATCH', { domain: 'warehouse', scenario })).status,
      ).toBe(200)
      const result = await request(path)
      expect(result.status).toBe(status)
      if (scenario === 'empty') expect(result.body).toMatchObject({ data: [], meta: { total: 0 } })
    }
  },
)
