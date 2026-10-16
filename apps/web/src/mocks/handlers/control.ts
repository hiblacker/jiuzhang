import type { Model } from '@/shared/api/types'
import { createSeed } from '../fixtures/seed'
import { route } from './core'
import { advanceJobs } from './jobs'
import { advanceQueries, advanceTransfers } from './warehouse'
import { mockNow, synchronizeSchedules } from '../model/scheduler'
export const controlHandlers = [
  route(
    'post',
    '/demo/tick',
    ({ state, body }) => {
      synchronizeSchedules(state, mockNow(state))
      state.scheduler!.offsetMs += (body as Model<'DemoClockInput'>).advanceSeconds * 1000
      const now = mockNow(state),
        clock = advanceJobs(state, now),
        queriesChanged = advanceQueries(state, now),
        transfersChanged = advanceTransfers(state, now)
      return { ...clock, changed: clock.changed || queriesChanged || transfersChanged }
    },
    { input: 'DemoClockInput', readAction: true },
  ),
  route('get', '/demo/control', ({ state }) => state.control),
  route(
    'patch',
    '/demo/control',
    ({ state, body }) => {
      state.control = body as Model<'Control'>
      return state.control
    },
    { input: 'Control' },
  ),
  route('post', '/demo/reset', ({ state }) => {
    delete state.scheduler
    Object.assign(state, createSeed())
    return { message: '演示数据已重置' }
  }),
]
