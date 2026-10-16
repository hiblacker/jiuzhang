import type { Model } from '@/shared/api/types'
import { nextScheduleTimes } from '@/shared/lib/schedule-time'
import type { MockState } from '../fixtures/seed'

export function mockNow(state: MockState) {
  return Date.now() + (state.scheduler?.offsetMs ?? 0)
}

export function synchronizeSchedules(state: MockState, now: number) {
  state.scheduler ??= { offsetMs: 0, cursors: {} }
  for (const task of state.tasks) {
    const version =
      state.datasets.find((dataset) => dataset.id === task.datasetId)?.publishedVersion ?? 0
    const signature = JSON.stringify([task.enabled, task.schedule, version])
    if (state.scheduler.cursors[task.id]?.signature === signature) continue
    state.scheduler.cursors[task.id] = {
      signature,
      nextAt:
        task.enabled && version > 0
          ? (nextScheduleTimes(task.schedule, now, 1).dates[0] ?? null)
          : null,
    }
  }
  for (const id of Object.keys(state.scheduler.cursors))
    if (!state.tasks.some((task) => task.id === id)) delete state.scheduler.cursors[id]
}

export function visibleTask(state: MockState, task: Model<'Task'>) {
  return { ...task, nextRunAt: state.scheduler?.cursors[task.id]?.nextAt ?? null }
}

export function visibleRun(state: MockState, run: Model<'Run'>) {
  const retryRunId = state.runs.find((candidate) => candidate.retryOf === run.id)?.id ?? ''
  const task = state.tasks.find((candidate) => candidate.id === run.taskId)
  return {
    ...run,
    retryRunId,
    retryPaused: Boolean(run.retryAt && !retryRunId && task && !task.enabled),
  }
}
