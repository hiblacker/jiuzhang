import type { Model } from '@/shared/api/types'
import type { MockState } from '../fixtures/seed'

export function terminalRun(run: Model<'Run'>) {
  return ['succeeded', 'failed', 'blocked', 'canceled'].includes(run.status)
}

export function admissionReason(state: MockState, run: Model<'Run'>): Model<'Run'>['waitReason'] {
  const dependenciesReady = run.scheduleSnapshot.dependencies.every((id) => {
    const latest = state.runs
      .filter(
        (candidate) =>
          candidate.taskId === id &&
          (!run.businessDate || candidate.businessDate === run.businessDate),
      )
      .sort(
        (a, b) =>
          Date.parse(b.startedAt) - Date.parse(a.startedAt) ||
          (BigInt(a.id) < BigInt(b.id) ? 1 : -1),
      )[0]
    return latest?.status === 'succeeded'
  })
  if (!dependenciesReady) return 'dependencies'
  const occupied = state.runs.filter(
    (candidate) =>
      candidate.id !== run.id &&
      candidate.taskId === run.taskId &&
      candidate.executionStartedAt !== null &&
      !terminalRun(candidate),
  ).length
  return occupied >= run.scheduleSnapshot.concurrency ? 'concurrency' : ''
}
