import { describe, expect, it } from 'vitest'
import { createSeed } from '../../fixtures/seed'
import { datasetPreview } from '../../handlers/datasets'
import { advanceRuns, createRun } from '../../handlers/jobs'
import { maskValue, mergeOutput, orderedNodes, sumDecimal } from '../dataset-runtime'
import { visiblePreview } from '../data-access'

describe('published samples and warehouse write invariants', () => {
  it('keeps sensitive origins across aliases, Join inputs and downstream versions', () => {
    const state = createSeed(),
      definition = state.datasets[0]!.definition
    const phone = definition.fields.find((field) => field.name === 'phone')!
    phone.target = 'contact'
    phone.sensitive = false
    phone.maskPolicyId = ''
    const preview = datasetPreview(state, definition)
    expect(preview.fields.find((field) => field.target === 'contact')?.sensitive).toBe(true)
    expect(visiblePreview(state, 'viewer', preview).rows[0]).not.toHaveProperty('contact')
    definition.nodes = [
      { id: 'left', type: 'input', label: 'left', x: 0, y: 0, config: '' },
      { id: 'right', type: 'input', label: 'right', x: 0, y: 200, config: '11003' },
      { id: 'join', type: 'join', label: 'join', x: 300, y: 0, config: 'left:id=id' },
    ]
    definition.edges = [
      { id: 'a', source: 'left', target: 'join' },
      { id: 'b', source: 'right', target: 'join' },
    ]
    definition.fields.push({ ...phone, name: 'right_phone', target: 'lookup_contact' })
    const joined = datasetPreview(state, definition)
    expect(joined.fields.find((field) => field.target === 'lookup_contact')?.sensitive).toBe(true)
    expect(visiblePreview(state, 'viewer', joined).rows[0]).not.toHaveProperty('lookup_contact')
    const downstream = state.datasets[1]!.definition
    downstream.upstreamDatasetId = '2001'
    downstream.fields.find((field) => field.name === 'phone')!.sensitive = false
    expect(
      datasetPreview(state, downstream).fields.find((field) => field.name === 'phone')?.sensitive,
    ).toBe(true)
  })
  it('previews the bound source schema after current metadata changes and rejects missing snapshots', () => {
    const state = createSeed(),
      version = state.versions[0]!
    const before = datasetPreview(state, version.definition, version)
    state.objects[0]!.fields = state.objects[0]!.fields.filter((field) => field.name !== 'amount')
    expect(datasetPreview(state, version.definition, version)).toEqual(before)
    expect(() => datasetPreview(state, version.definition)).toThrow('amount 不允许空值')
    version.sourceSnapshots = []
    expect(() => datasetPreview(state, version.definition, version)).toThrow(
      '绑定版本缺少源结构快照',
    )
  })
  it('resolves an upstream version with its own schemas and policies rather than the downstream snapshots', () => {
    const state = createSeed(),
      upstream = state.versions[0]!,
      downstream = state.versions[1]!
    downstream.definition = structuredClone(upstream.definition)
    downstream.definition.upstreamDatasetId = upstream.datasetId
    downstream.upstreamVersion = upstream.version
    downstream.definition.qualityRuleIds = []
    downstream.definition.maskPolicyIds = []
    downstream.definition.fields.forEach((field) => {
      field.maskPolicyId = ''
      field.sensitive = false
    })
    downstream.qualitySnapshot = []
    downstream.maskingSnapshot = []
    downstream.sourceSnapshots = []
    state.objects = []
    state.masking[0]!.parameter = '1,1'
    const preview = datasetPreview(state, downstream.definition, downstream)
    expect(preview.rows[0]).toMatchObject({ id: '100', phone: '138****0000', amount: '120.50' })
    expect(preview.rows).toHaveLength(12)
    expect(preview.qualityResults).toEqual([])
  })
  it('persists invalid publication as failed without changing warehouse or success cursor', () => {
    const state = createSeed(),
      start = '2026-10-15T00:00:00Z'
    state.versions[0]!.definition.output.keys = ['missing']
    const before = structuredClone(state.tables)
    const run = createRun(state, '2001', 'succeeded', 'manual', start)
    expect(() => advanceRuns(state, Date.parse(start) + 10000)).not.toThrow()
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'PUBLICATION_FAILED',
      outputTableId: '',
    })
    expect(state.tables).toEqual(before)
    expect(state.tasks[0]!.lastSuccessRunId).toBe('')
  })
  it('keeps historical mask and quality versions after current policies change', () => {
    const state = createSeed(),
      version = state.versions[0]!
    state.masking[0]!.parameter = '1,1'
    state.quality[0]!.version = 2
    expect(datasetPreview(state, version.definition, version).rows[0]!.phone).toBe('138****0000')
    expect(datasetPreview(state, version.definition).rows[0]!.phone).toBe('1*********0')
    const run = createRun(state, version.datasetId, 'succeeded', 'manual', '2026-10-15T00:00:00Z')
    expect(run.qualityResults).toEqual([])
    advanceRuns(state, Date.parse('2026-10-15T00:00:06Z'))
    expect(run.qualityResults[0]!.version).toBe(1)
  })
  it('traverses edges instead of insertion order and rejects cycles', () => {
    const definition = createSeed().datasets[0]!.definition
    definition.nodes.reverse()
    expect(orderedNodes(definition).map((node) => node.id)).toEqual(['input', 'fields'])
    definition.edges.push({ id: 'back', source: 'fields', target: 'input' })
    expect(() => orderedNodes(definition)).toThrow('循环')
  })
  it('sums large decimal strings without floating point loss', () => {
    expect(sumDecimal(['9999999999999999.99', '0.01', '-1.00'])).toBe('9999999999999999.00')
    expect(() => sumDecimal(['1.001'])).toThrow()
    expect(maskValue('abc')).toBe('***')
  })
  it('distinguishes append, replace and key-based upsert', () => {
    const output = createSeed().datasets[0]!.definition.output
    const previous = [{ id: '1', amount: '1.00' }],
      next = [
        { id: '1', amount: '2.00' },
        { id: '2', amount: '3.00' },
      ]
    expect(mergeOutput(previous, next, { ...output, writeMode: 'append' })).toHaveLength(3)
    expect(mergeOutput(previous, next, { ...output, writeMode: 'replace' })).toEqual(next)
    expect(mergeOutput(previous, next, output)).toEqual(next)
    expect(previous[0]!.amount).toBe('1.00')
    expect(() => mergeOutput([], [{ id: null }], output)).toThrow('业务主键')
  })
  it('does not publish or advance the success cursor for blocked and canceled runs', () => {
    const state = createSeed(),
      start = '2026-10-15T00:00:00Z'
    const task = state.tasks[0]!,
      before = structuredClone(state.tables)
    const blocked = createRun(state, '2001', 'blocked', 'manual', start)
    const canceled = createRun(state, '2001', 'succeeded', 'manual', start)
    canceled.status = 'canceled'
    advanceRuns(state, Date.parse(start) + 10000)
    expect(blocked.status).toBe('blocked')
    expect(canceled.status).toBe('canceled')
    expect(state.tables).toEqual(before)
    expect(task.lastSuccessRunId).toBe('')
    const retry = createRun(state, '2001', 'succeeded', 'retry', start, blocked.id)
    advanceRuns(state, Date.parse(start) + 10000)
    expect(retry.id).not.toBe(blocked.id)
    expect(retry.datasetVersion).toBe(blocked.datasetVersion)
    expect(retry.status).toBe('succeeded')
    expect(blocked.status).toBe('blocked')
    expect(task.lastSuccessRunId).toBe(retry.id)
  })
})
