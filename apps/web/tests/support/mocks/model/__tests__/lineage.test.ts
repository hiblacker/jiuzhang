import { describe, expect, it } from 'vitest'
import { createSeed } from '../../fixtures/seed'
import { fieldLineage } from '../lineage'
import { captureSourceSchemas } from '../source-snapshot'

describe('published field provenance', () => {
  it('uses bound table version even if the current draft was renamed', () => {
    const state = createSeed()
    state.datasets[0]!.definition.fields[0]!.target = 'draft_id'
    const graph = fieldLineage(state)
    expect(graph.edges).toContainEqual({
      id: 'source-field-2001:1:11001:id->dataset-field-2001:1:id',
      source: 'source-field-2001:1:11001:id',
      target: 'dataset-field-2001:1:id',
    })
    expect(graph.edges).toContainEqual({
      id: 'dataset-field-2001:1:id->table-field-4001:id',
      source: 'dataset-field-2001:1:id',
      target: 'table-field-4001:id',
    })
    expect(graph.nodes.some((node) => node.fieldName === 'draft_id')).toBe(false)
    expect(
      graph.edges.every(
        (edge) =>
          graph.nodes.some((node) => node.id === edge.source) &&
          graph.nodes.some((node) => node.id === edge.target),
      ),
    ).toBe(true)
  })
  it('tracks right-hand Join inputs and omits removed policy outputs', () => {
    const state = createSeed(),
      version = state.versions[0]!
    const field = version.definition.fields[0]!
    version.definition.nodes = [
      { id: 'left', type: 'input', label: 'left', x: 0, y: 0, config: '' },
      { id: 'right', type: 'input', label: 'right', x: 0, y: 0, config: '11003' },
      { id: 'join', type: 'join', label: 'join', x: 0, y: 0, config: 'left:id=id' },
    ]
    version.definition.edges = [
      { id: 'left-join', source: 'left', target: 'join' },
      { id: 'right-join', source: 'right', target: 'join' },
    ]
    version.definition.fields = [
      { ...field, name: 'right_id', target: 'lookup_id' },
      { ...field, target: 'removed_id', maskPolicyId: '6002' },
    ]
    version.maskingSnapshot = state.masking.filter((policy) => policy.id === '6002')
    version.sourceSnapshots = captureSourceSchemas(state.objects, state.sources, version.definition)
    const graph = fieldLineage(state)
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === 'source-field-2001:1:11003:id' &&
          edge.target === 'dataset-field-2001:1:lookup_id',
      ),
    ).toBe(true)
    expect(graph.nodes.some((node) => node.id === 'dataset-field-2001:1:removed_id')).toBe(false)
  })
  it('keeps historical source schemas separate when the same object changes between versions', () => {
    const state = createSeed()
    const first = state.versions[0]!
    const next = structuredClone(first)
    next.id = '22001'
    next.version = 2
    next.sourceSnapshots[0]!.sourceName = '新的源名称'
    next.sourceSnapshots[0]!.object.fields[0]!.type = 'integer'
    state.versions.push(next)
    state.objects[0]!.fields = []
    const graph = fieldLineage(state)
    const before = graph.nodes.find((node) => node.id === 'source-field-2001:1:11001:id')
    const after = graph.nodes.find((node) => node.id === 'source-field-2001:2:11001:id')
    expect(before?.label).toContain(first.sourceSnapshots[0]!.sourceName)
    expect(before?.label).not.toContain('新的源名称')
    expect(after?.label).toContain('新的源名称')
    expect(before?.path).toBe('/datasets/2001/versions/1?sourceObjectId=11001&field=id')
    expect(after?.path).toBe('/datasets/2001/versions/2?sourceObjectId=11001&field=id')
    expect(
      graph.edges.some(
        (edge) => edge.source === before?.id && edge.target === 'dataset-field-2001:2:id',
      ),
    ).toBe(false)
  })
  it('marks unsupported SQL provenance unknown rather than inventing edges', () => {
    const state = createSeed()
    state.versions[0]!.definition.mode = 'sql'
    state.versions[0]!.definition.sql = 'SELECT arbitrary_expression FROM secret'
    const graph = fieldLineage(state)
    expect(graph.notes.some((note) => note.includes('字段依赖未解析'))).toBe(true)
    expect(graph.edges.some((edge) => edge.target.startsWith('dataset-field-2001:1:'))).toBe(false)
  })
})
