import { describe, expect, it } from 'vitest'
import { createSeed } from '../../fixtures/seed'
import { advanceRuns, createRun } from '../../handlers/jobs'

const start = '2026-10-16T00:00:00.000Z'
const clock = Date.parse(start)
describe('mock execution admission and immutable run inputs', () => {
  it('queues concurrent runs FIFO and does not report quality before evaluation', () => {
    const state = createSeed()
    const first = createRun(state, '2001', 'succeeded', 'manual', start)
    const second = createRun(state, '2001', 'succeeded', 'manual', start)
    expect(first.qualityResults).toEqual([])
    expect(second).toMatchObject({
      status: 'queued',
      waitReason: 'concurrency',
      executionStartedAt: null,
      qualityResults: [],
    })
    state.tasks[0]!.schedule.concurrency = 10
    advanceRuns(state, clock + 6000)
    expect(first.status).toBe('publishing')
    expect(second.waitReason).toBe('concurrency')
    expect(first.qualityResults[0]?.result).toBe('PASS')
    advanceRuns(state, clock + 8000)
    expect(first.status).toBe('succeeded')
    expect(second.executionStartedAt).toBe('2026-10-16T00:00:08.000Z')
    expect(second.qualityResults).toEqual([])
    advanceRuns(state, clock + 16000)
    expect(second.status).toBe('succeeded')
    expect(second.scheduleSnapshot.concurrency).toBe(1)
    expect(first.finishedAt).toBe('2026-10-16T00:00:07.500Z')
  })
  it('waits for latest upstream success, then releases the dependent without rewriting its version', () => {
    const state = createSeed()
    state.tasks[1]!.schedule.dependencies = ['3001']
    const upstream = createRun(state, '2001', 'succeeded', 'manual', start)
    const downstream = createRun(state, '2002', 'succeeded', 'manual', start)
    expect(downstream.waitReason).toBe('dependencies')
    advanceRuns(state, clock + 8000)
    expect(upstream.status).toBe('succeeded')
    expect(downstream.executionStartedAt).toBe('2026-10-16T00:00:08.000Z')
    advanceRuns(state, clock + 16000)
    expect(downstream.status).toBe('succeeded')
    expect(downstream.datasetVersion).toBe(1)
  })
  it('times out dependency wait and active execution without publishing or advancing the cursor', () => {
    const state = createSeed()
    const before = structuredClone(state.tables)
    state.tasks[0]!.schedule.timeoutSeconds = 2
    state.tasks[1]!.schedule = {
      ...state.tasks[1]!.schedule,
      timeoutSeconds: 2,
      dependencies: ['3001'],
    }
    const active = createRun(state, '2001', 'succeeded', 'manual', start)
    const waiting = createRun(state, '2002', 'succeeded', 'manual', start)
    advanceRuns(state, clock + 9000)
    for (const run of [active, waiting]) {
      expect(run).toMatchObject({
        status: 'failed',
        errorCode: 'SLA_TIMEOUT',
        durationMs: 2000,
        outputTableId: '',
        qualityResults: [],
      })
    }
    expect(state.tables).toEqual(before)
    expect(state.tasks.slice(0, 2).map((task) => task.lastSuccessRunId)).toEqual(['', ''])
    expect(
      state.audit.filter(
        (event) => event.resource === 'runs' && [active.id, waiting.id].includes(event.resourceId),
      ),
    ).toHaveLength(2)
    advanceRuns(state, clock + 100000)
    expect(state.tables).toEqual(before)
  })
  it('requires same-day upstream backfills and keeps the business date on retry', () => {
    const state = createSeed()
    state.tasks[1]!.schedule.dependencies = ['3001']
    const first = createRun(state, '2001', 'succeeded', 'backfill', start, '', '2026-10-13')
    const downstream = createRun(state, '2002', 'succeeded', 'backfill', start, '', '2026-10-14')
    advanceRuns(state, clock + 8000)
    expect(first.status).toBe('succeeded')
    expect(downstream.waitReason).toBe('dependencies')
    const matching = createRun(
      state,
      '2001',
      'succeeded',
      'backfill',
      new Date(clock + 8000).toISOString(),
      '',
      '2026-10-14',
    )
    advanceRuns(state, clock + 16000)
    expect(matching.status).toBe('succeeded')
    advanceRuns(state, clock + 16001)
    expect(downstream.waitReason).toBe('')
    const canceled = createRun(state, '2001', 'succeeded', 'backfill', start, '', '2026-10-12')
    canceled.status = 'canceled'
    const retry = createRun(state, '2001', 'succeeded', 'retry', start, canceled.id)
    expect(retry).toMatchObject({
      businessDate: '2026-10-12',
      retryOf: canceled.id,
      datasetVersion: canceled.datasetVersion,
    })
  })
  it('releases a diamond only after both latest branches succeed and keeps the queued snapshot', () => {
    const state = createSeed()
    state.runs = []
    for (const task of state.tasks) {
      task.schedule.mode = 'manual'
      task.schedule.retries = 0
      task.schedule.timeoutSeconds = 600
      task.schedule.dependencies = []
    }
    state.tasks[1]!.schedule.dependencies = ['3001']
    state.tasks[2]!.schedule.dependencies = ['3001']
    state.tasks[3]!.schedule.dependencies = ['3002', '3003']
    const root = createRun(state, '2001', 'succeeded', 'manual', start)
    const left = createRun(state, '2002', 'succeeded', 'manual', start)
    const right = createRun(state, '2003', 'failed', 'manual', start)
    const leaf = createRun(state, '2004', 'succeeded', 'manual', start)
    const snapshot = structuredClone(leaf.scheduleSnapshot)
    // Editing the current task must not bypass admission for an already queued run.
    state.tasks[3]!.schedule.dependencies = []
    state.tasks[3]!.schedule.concurrency = 10
    advanceRuns(state, clock + 8000)
    expect(root.status).toBe('succeeded')
    expect(left.executionStartedAt).not.toBeNull()
    expect(right.executionStartedAt).not.toBeNull()
    expect(leaf.waitReason).toBe('dependencies')
    advanceRuns(state, clock + 16000)
    expect(left.status).toBe('succeeded')
    expect(right.status).toBe('failed')
    expect(leaf.executionStartedAt).toBeNull()
    const retry = createRun(
      state,
      '2003',
      'succeeded',
      'retry',
      new Date(clock + 16000).toISOString(),
      right.id,
    )
    advanceRuns(state, clock + 24000)
    expect(retry.status).toBe('succeeded')
    expect(leaf.executionStartedAt).toBeNull()
    // The leaf was created earlier than the recovery run: the next observation admits it.
    advanceRuns(state, clock + 24001)
    expect(leaf.executionStartedAt).toBe(new Date(clock + 24001).toISOString())
    const newerFailure = createRun(
      state,
      '2002',
      'failed',
      'manual',
      new Date(clock + 24001).toISOString(),
    )
    advanceRuns(state, clock + 32001)
    expect(newerFailure.status).toBe('failed')
    expect(leaf.status).toBe('succeeded')
    expect(leaf.scheduleSnapshot).toEqual(snapshot)
    expect(state.tasks[3]!.lastSuccessRunId).toBe(leaf.id)
    expect(state.tables.find((table) => table.id === leaf.outputTableId)?.datasetVersion).toBe(1)
  })
  it('isolates backfill dates and never lets an older success bypass a newer canceled run', () => {
    const state = createSeed()
    state.runs = []
    state.tasks[1]!.schedule.dependencies = ['3001']
    const first = createRun(state, '2001', 'succeeded', 'backfill', start, '', '2026-10-13')
    advanceRuns(state, clock + 8000)
    expect(first.status).toBe('succeeded')
    const newer = createRun(state, '2001', 'succeeded', 'backfill', start, '', '2026-10-13')
    newer.status = 'canceled'
    const downstream = createRun(state, '2002', 'succeeded', 'backfill', start, '', '2026-10-13')
    const otherDay = createRun(state, '2001', 'succeeded', 'backfill', start, '', '2026-10-14')
    advanceRuns(state, clock + 16000)
    expect(otherDay.status).toBe('succeeded')
    expect(downstream).toMatchObject({ waitReason: 'dependencies', executionStartedAt: null })
    state.tasks[0]!.schedule.timeoutSeconds = 10
    const retry = createRun(
      state,
      '2001',
      'succeeded',
      'retry',
      new Date(clock + 16000).toISOString(),
      newer.id,
    )
    expect(retry.scheduleSnapshot).toEqual(newer.scheduleSnapshot)
    expect(retry.businessDate).toBe('2026-10-13')
    advanceRuns(state, clock + 24000)
    advanceRuns(state, clock + 24001)
    expect(downstream.waitReason).toBe('')
    advanceRuns(state, clock + 32001)
    expect(downstream.status).toBe('succeeded')
    expect(
      state.tables.find((table) => table.id === downstream.outputTableId)?.partitions,
    ).toContain('2026-10-13')
    expect(newer.status).toBe('canceled')
  })
})
