import { describe, expect, it } from 'vitest'
import { createSeed } from '../../fixtures/seed'
import { advanceTransfers } from '../../handlers/warehouse'

describe('persistent transfer transitions', () => {
  it('publishes a successful import once and never publishes a failed import', () => {
    const state = createSeed(),
      start = Date.parse('2026-10-15T00:00:00Z')
    const before = state.tables.length
    for (const [id, outcome] of [
      ['80001', 'succeeded'],
      ['80002', 'failed'],
    ] as const) {
      state.imports.push({
        id,
        name: id,
        tableId: '',
        status: 'queued',
        rowCount: '0',
        progress: 0,
        createdAt: new Date(start).toISOString(),
        error: '',
      })
      state.pendingImports[id] = {
        table: { ...structuredClone(state.tables[0]!), id: '9' + id, name: 'demo_' + id },
        outcome,
      }
    }
    advanceTransfers(state, start + 1000)
    expect(state.imports.every((task) => task.status === 'running' && task.progress > 0)).toBe(true)
    expect(state.tables).toHaveLength(before)
    const restored = structuredClone(state)
    advanceTransfers(restored, start + 3000)
    expect(restored.imports.find((task) => task.id === '80001')).toMatchObject({
      status: 'succeeded',
      progress: 100,
      tableId: '980001',
    })
    expect(restored.imports.find((task) => task.id === '80002')).toMatchObject({
      status: 'failed',
      progress: 100,
      tableId: '',
      rowCount: '0',
    })
    expect(restored.tables).toHaveLength(before + 1)
    advanceTransfers(restored, start + 5000)
    expect(restored.tables).toHaveLength(before + 1)
    expect(restored.pendingImports).toEqual({})
  })
  it('keeps exports pending until ready and clears failed contents', () => {
    const state = createSeed(),
      start = Date.parse('2026-10-15T00:00:00Z')
    for (const [id, outcome] of [
      ['80001', 'ready'],
      ['80002', 'failed'],
    ] as const) {
      state.exports.push({
        id,
        userId: '8002',
        columns: ['id'],
        queryId: '1',
        format: 'csv',
        status: 'preparing',
        progress: 0,
        fileName: 'demo.csv',
        content: 'id\n1',
        createdAt: new Date(start).toISOString(),
        expiresAt: new Date(start + 86400000).toISOString(),
      })
      state.pendingExports[id] = outcome
    }
    advanceTransfers(state, start + 500)
    expect(state.exports.every((task) => task.status === 'preparing')).toBe(true)
    advanceTransfers(state, start + 2000)
    expect(state.exports.find((task) => task.id === '80001')).toMatchObject({
      status: 'ready',
      progress: 100,
      content: 'id\n1',
    })
    expect(state.exports.find((task) => task.id === '80002')).toMatchObject({
      status: 'failed',
      progress: 100,
      content: '',
    })
    expect(state.pendingExports).toEqual({})
  })
})
