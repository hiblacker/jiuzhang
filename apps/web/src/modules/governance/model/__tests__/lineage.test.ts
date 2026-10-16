import { it, expect } from 'vitest'
import { lineageScope, layoutLineage } from '../lineage'
import type { Model } from '@/shared/api/types'
it('keeps upstream and downstream traversals separate and excludes sibling branches', () => {
  const edges = [
    ['source', 'selected'],
    ['source', 'sibling'],
    ['selected', 'table'],
    ['sibling', 'other'],
  ].map(([source, target]) => ({ id: source + '-' + target, source: source!, target: target! }))
  expect([...lineageScope(edges, ['selected'], 'upstream')].sort()).toEqual(['selected', 'source'])
  expect([...lineageScope(edges, ['selected'], 'downstream')].sort()).toEqual(['selected', 'table'])
  expect([...lineageScope(edges, ['selected'], 'both')].sort()).toEqual([
    'selected',
    'source',
    'table',
  ])
})

it('lays out multi-level dependencies left to right without overlapping nodes in each column', () => {
  const nodes: Model<'Lineage'>['nodes'] = [
    { id: 'source', kind: 'source' },
    { id: 'first', kind: 'dataset' },
    { id: 'left', kind: 'dataset' },
    { id: 'right', kind: 'dataset' },
    { id: 'joined', kind: 'dataset' },
    { id: 'table', kind: 'table' },
  ].map((node) => ({
    ...node,
    label: node.id,
    path: '/',
    resourceId: node.id,
    fieldName: '',
  })) as Model<'Lineage'>['nodes']
  const edges = [
    ['source', 'first'],
    ['first', 'left'],
    ['first', 'right'],
    ['left', 'joined'],
    ['right', 'joined'],
    ['joined', 'table'],
  ].map(([source, target]) => ({ id: source + '-' + target, source: source!, target: target! }))
  const result = layoutLineage(nodes, edges)
  const byId = new Map(result.map((node) => [node.id, node]))
  for (const edge of edges)
    expect(byId.get(edge.source)!.position.x).toBeLessThan(byId.get(edge.target)!.position.x)
  expect(byId.get('left')!.position.x).toBe(byId.get('right')!.position.x)
  expect(byId.get('left')!.position.y).not.toBe(byId.get('right')!.position.y)
  expect(layoutLineage(nodes, edges)).toEqual(result)
  expect(nodes.every((node) => !('position' in node))).toBe(true)
})

it('handles a large chain, disconnected nodes, dangling edges and legacy cycles with finite positions', () => {
  const nodes: Model<'Lineage'>['nodes'] = Array.from({ length: 600 }, (_, index) => ({
    id: String(index),
    kind: 'dataset',
    label: String(index),
    path: '/',
    resourceId: String(index),
    fieldName: '',
  }))
  const edges = nodes
    .slice(1)
    .map((node, index) => ({ id: node.id, source: String(index), target: node.id }))
  const result = layoutLineage(nodes, edges)
  expect(result.at(-1)!.position.x - result[0]!.position.x).toBe(599 * 320)
  const legacy = layoutLineage(nodes.slice(0, 4), [
    { id: 'a', source: '0', target: '1' },
    { id: 'b', source: '1', target: '0' },
    { id: 'outside', source: 'missing', target: '2' },
  ])
  expect(new Set(legacy.map((node) => node.position.x + ':' + node.position.y)).size).toBe(4)
  expect(
    legacy.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)),
  ).toBe(true)
})
