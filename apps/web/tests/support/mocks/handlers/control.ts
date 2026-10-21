import { createSeed } from '../fixtures/seed'
import { ensure, route } from './core'
import { advanceJobs } from './jobs'
import { advanceQueries, advanceTransfers } from './warehouse'
import { mockNow, synchronizeSchedules } from '../model/scheduler'
export const controlHandlers = [
  route(
    'post',
    '/_test/clock',
    ({ state, body }) => {
      const seconds = (body as { advanceSeconds?: unknown }).advanceSeconds
      ensure(
        typeof seconds === 'number' &&
          Number.isInteger(seconds) &&
          seconds >= 0 &&
          seconds <= 86400,
        422,
        'VALIDATION_ERROR',
        '测试时钟步长必须是 0 到 86400 秒的整数',
      )
      synchronizeSchedules(state, mockNow(state))
      state.scheduler!.offsetMs += seconds * 1000
      const now = mockNow(state),
        clock = advanceJobs(state, now),
        queriesChanged = advanceQueries(state, now),
        transfersChanged = advanceTransfers(state, now)
      return { ...clock, changed: clock.changed || queriesChanged || transfersChanged }
    },
    { readAction: true },
  ),
  route('get', '/_test/control', ({ state }) => state.control),
  route('patch', '/_test/control', ({ state, body }) => {
    state.control = body as typeof state.control
    return state.control
  }),
  route('post', '/_test/reset', ({ state }) => {
    delete state.scheduler
    Object.assign(state, createSeed())
    return { message: '演示数据已重置' }
  }),
]
