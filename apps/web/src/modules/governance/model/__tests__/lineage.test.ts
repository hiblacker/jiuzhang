import { it, expect } from 'vitest'
import { lineageScope } from '../lineage'
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
