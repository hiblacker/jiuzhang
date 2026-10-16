import { describe, expect, it } from 'vitest'
import { createSeed, sampleRows } from '../../fixtures/seed'
import { executeGraph, convertValue } from '../dataset-runtime'
import { evaluateQuality, qualityScenario } from '../quality-runtime'
import { advanceRuns, createRun } from '../../handlers/jobs'

describe('configured sample transformations', () => {
  it('evaluates independent graph branches and unions only their outputs', () => {
    const definition = createSeed().datasets[0]!.definition
    definition.nodes = [
      { id: 'input', type: 'input', label: 'input', x: 0, y: 0, config: '' },
      { id: 'a', type: 'filter', label: 'a', x: 0, y: 0, config: 'city=杭州' },
      { id: 'b', type: 'filter', label: 'b', x: 0, y: 0, config: 'city=上海' },
      { id: 'union', type: 'union', label: 'union', x: 0, y: 0, config: 'all' },
    ]
    definition.edges = [
      ['input', 'a'],
      ['input', 'b'],
      ['a', 'union'],
      ['b', 'union'],
    ].map(([source, target]) => ({ id: source + '-' + target, source: source!, target: target! }))
    const rows = executeGraph(definition, sampleRows, () => sampleRows)
    expect(rows).toHaveLength(8)
    expect(new Set(rows.map((row) => row.city))).toEqual(new Set(['杭州', '上海']))
    definition.nodes[3]!.config = 'invalid'
    expect(() => executeGraph(definition, sampleRows, () => sampleRows)).toThrow('Union')
  })
  it('joins by configured keys and aggregates exact decimal strings', () => {
    const definition = createSeed().datasets[0]!.definition
    definition.nodes = [
      { id: 'left', type: 'input', label: 'left', x: 0, y: 0, config: '' },
      { id: 'right', type: 'input', label: 'right', x: 0, y: 0, config: 'lookup' },
      { id: 'join', type: 'join', label: 'join', x: 0, y: 0, config: 'left:id=id' },
    ]
    definition.edges = [
      ['left', 'join'],
      ['right', 'join'],
    ].map(([source, target]) => ({ id: source + '-' + target, source: source!, target: target! }))
    const rows = executeGraph(
      definition,
      [
        { id: '1', amount: '100.10' },
        { id: '2', amount: '0.90' },
      ],
      () => [{ id: '1', city: '杭州' }],
    )
    expect(rows).toEqual([
      { id: '1', amount: '100.10', right_id: '1', right_city: '杭州' },
      { id: '2', amount: '0.90', right_id: null, right_city: null },
    ])
    definition.nodes.push({
      id: 'sum',
      type: 'aggregate',
      label: 'sum',
      x: 0,
      y: 0,
      config: 'sum:amount',
    })
    definition.edges.push({ id: 'join-sum', source: 'join', target: 'sum' })
    expect(
      executeGraph(
        definition,
        [
          { id: '1', amount: '100.10' },
          { id: '2', amount: '0.90' },
        ],
        () => [{ id: '1', city: '杭州' }],
      ),
    ).toEqual([{ amount: '101.00' }])
  })
  it('rejects invalid conversion and preserves integers beyond safe number precision', () => {
    const field = createSeed().datasets[0]!.definition.fields[0]!
    expect(convertValue('9007199254740993', { ...field, type: 'integer' })).toBe('9007199254740993')
    expect(convertValue('42', { ...field, type: 'integer' })).toBe(42)
    expect(convertValue('false', { ...field, type: 'boolean' })).toBe(false)
    expect(convertValue('1.2', { ...field, type: 'decimal(18,2)' })).toBe('1.20')
    expect(() => convertValue('1.234', { ...field, type: 'decimal(18,2)' })).toThrow('小数位')
    expect(() => convertValue('2026-02-30', { ...field, type: 'date' })).toThrow('日期')
  })
  it('evaluates required, uniqueness, range, enumeration and freshness with sample evidence', () => {
    const state = createSeed(),
      now = Date.parse('2026-10-15T00:00:00Z')
    for (const rule of state.quality) {
      expect(qualityScenario(rule, 'pass', now)).toMatchObject({
        result: 'PASS',
        failed: 0,
        passRate: 100,
      })
      expect(qualityScenario(rule, 'warn', now)).toMatchObject({ result: 'WARN' })
      expect(qualityScenario(rule, 'block', now).failed).toBeGreaterThan(0)
    }
    const range = { ...state.quality[2]!, parameter: '9999999999999999.90,9999999999999999.99' }
    expect(evaluateQuality(range, [{ amount: '10000000000000000.00' }], now).result).toBe('BLOCK')
  })
  it('blocks warehouse publication when bound quality rule fails actual samples', () => {
    const state = createSeed(),
      start = '2026-10-15T00:00:00Z'
    const rule = { ...state.quality[2]!, parameter: '0,1' }
    state.versions[0]!.qualitySnapshot = [rule]
    state.versions[0]!.definition.qualityRuleIds = [rule.id]
    const tables = structuredClone(state.tables),
      run = createRun(state, '2001', 'succeeded', 'manual', start)
    advanceRuns(state, Date.parse(start) + 10000)
    expect(run.status).toBe('blocked')
    expect(run.qualityResults[0]).toMatchObject({
      ruleId: rule.id,
      result: 'BLOCK',
      version: rule.version,
    })
    expect(state.tables).toEqual(tables)
    expect(state.tasks[0]!.lastSuccessRunId).toBe('')
  })
  it('checks freshness at execution time and preserves the result across later reads', () => {
    const state = createSeed()
    const start = Date.parse('2026-10-15T00:00:00Z')
    const rule = { ...state.quality[4]!, parameter: '1' }
    const row = { updated_at: '2026-10-14T23:00:05.500Z' }
    expect(evaluateQuality(rule, [row], start + 5500).result).toBe('PASS')
    expect(evaluateQuality(rule, [row], start + 5501).result).toBe('BLOCK')
    expect(
      evaluateQuality(rule, [{ updated_at: '2026-10-15T00:00:05.501Z' }], start + 5500).result,
    ).toBe('BLOCK')
    const version = state.versions[0]!
    // Numeric sample IDs are not fresh timestamps. The bound rule blocks the run.
    version.definition.qualityRuleIds = [rule.id]
    version.qualitySnapshot = [{ ...rule, field: 'id' }]
    const run = createRun(state, '2001', 'succeeded', 'manual', new Date(start).toISOString())
    advanceRuns(state, start + 5500)
    expect(run.status).toBe('blocked')
    const results = structuredClone(run.qualityResults)
    state.quality[4]!.enabled = false
    advanceRuns(state, start + 86400000)
    expect(run.qualityResults).toEqual(results)
    expect(state.tasks[0]!.lastSuccessRunId).toBe('')
  })
})
