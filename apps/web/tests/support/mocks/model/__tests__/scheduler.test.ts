import { expect, it } from 'vitest'
import { createSeed } from '../../fixtures/seed'
import { advanceJobs, createRun } from '../../handlers/jobs'
import { synchronizeSchedules, visibleRun } from '../scheduler'

function oneTaskState() {
  const state = createSeed()
  state.runs = []
  state.tasks = state.tasks.slice(0, 1)
  const task = state.tasks[0]!
  task.schedule = {
    ...task.schedule,
    mode: 'manual',
    retries: 1,
    timeoutSeconds: 60,
    dependencies: [],
  }
  task.enabled = true
  return { state, task }
}

it('dispatches one due occurrence and advances its persistent cursor exactly once', () => {
  const { state, task } = oneTaskState()
  const start = Date.parse('2026-10-16T00:00:15.000Z')
  task.schedule = { ...task.schedule, mode: 'cron', cron: '* * * * *', timezone: 'UTC' }
  synchronizeSchedules(state, start)
  expect(state.scheduler?.cursors[task.id]?.nextAt).toBe('2026-10-16T00:01:00.000Z')

  const due = Date.parse('2026-10-16T00:01:03.000Z')
  expect(advanceJobs(state, due)).toMatchObject({ scheduledRuns: 1, retryRuns: 0, changed: true })
  expect(state.runs).toHaveLength(1)
  expect(state.runs[0]).toMatchObject({
    trigger: 'schedule',
    startedAt: new Date(due).toISOString(),
  })
  expect(state.scheduler?.cursors[task.id]?.nextAt).toBe('2026-10-16T00:02:00.000Z')

  expect(advanceJobs(state, due)).toMatchObject({ scheduledRuns: 0, retryRuns: 0, changed: false })
  expect(state.runs).toHaveLength(1)
  expect(state.audit.filter((entry) => entry.action === 'schedule')).toEqual([
    expect.objectContaining({
      actor: 'scheduler-demo',
      resource: 'runs',
      resourceId: state.runs[0]!.id,
    }),
  ])
})

it('holds a due automatic retry while paused and respects the retry budget after resume', () => {
  const { state, task } = oneTaskState()
  const start = Date.parse('2026-10-16T00:00:00.000Z')
  const original = createRun(
    state,
    task.datasetId,
    'failed',
    'manual',
    new Date(start).toISOString(),
  )
  advanceJobs(state, start + 5500)
  expect(original.status).toBe('failed')
  expect(original.retryAt).toBe(new Date(start + 10500).toISOString())

  task.enabled = false
  advanceJobs(state, start + 11000)
  expect(state.runs).toHaveLength(1)
  expect(visibleRun(state, original).retryPaused).toBe(true)

  task.enabled = true
  expect(advanceJobs(state, start + 11000).retryRuns).toBe(1)
  const retry = state.runs.find((run) => run.retryOf === original.id)!
  expect(retry).toMatchObject({ retryMode: 'automatic', retryAttempt: 1, datasetVersion: 1 })
  expect(visibleRun(state, original).retryRunId).toBe(retry.id)

  advanceJobs(state, start + 16500)
  expect(retry.status).toBe('failed')
  expect(retry.retryAt).toBeNull()
  expect(advanceJobs(state, start + 30000).retryRuns).toBe(0)
  expect(state.runs.filter((run) => run.retryOf)).toHaveLength(1)
  expect(state.audit.filter((entry) => entry.action === 'retry')).toEqual([
    expect.objectContaining({
      actor: 'scheduler-demo',
      resource: 'runs',
      resourceId: retry.id,
      detail: '重试运行 ' + original.id,
    }),
  ])
})

it('does not automatically retry quality-blocked or canceled runs', () => {
  const { state, task } = oneTaskState()
  const start = Date.parse('2026-10-16T00:00:00.000Z')
  const blocked = createRun(
    state,
    task.datasetId,
    'blocked',
    'manual',
    new Date(start).toISOString(),
  )
  const canceled = createRun(
    state,
    task.datasetId,
    'failed',
    'manual',
    new Date(start).toISOString(),
  )
  canceled.status = 'canceled'
  canceled.finishedAt = new Date(start + 1000).toISOString()
  advanceJobs(state, start + 6000)
  expect(blocked.status).toBe('blocked')
  expect(blocked.retryAt).toBeNull()
  expect(canceled.status).toBe('canceled')
  expect(advanceJobs(state, start + 30000).retryRuns).toBe(0)
})
