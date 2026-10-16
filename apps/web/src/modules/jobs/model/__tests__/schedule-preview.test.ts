import { expect, it } from 'vitest'
import { previewSchedule } from '../schedule-preview'
import type { Model } from '@/shared/api/types'
import { validCron } from '@/shared/lib/cron'
import { scheduleIssue } from '../schedule-validation'
const schedule: Model<'Schedule'> = {
  mode: 'cron',
  cron: '0 9 * * *',
  timezone: 'Asia/Shanghai',
  intervalMinutes: 60,
  retries: 0,
  timeoutSeconds: 60,
  concurrency: 1,
  dependencies: [],
}
it('previews daily triggers in the selected timezone and strictly after the given time', () => {
  expect(previewSchedule(schedule, Date.parse('2026-10-15T00:59:00Z'), 1).dates).toEqual([
    '2026-10-15T01:00:00.000Z',
  ])
  expect(previewSchedule(schedule, Date.parse('2026-10-15T01:00:00Z'), 1).dates).toEqual([
    '2026-10-16T01:00:00.000Z',
  ])
  expect(
    previewSchedule({ ...schedule, timezone: 'UTC' }, Date.parse('2026-10-15T00:59:00Z'), 1).dates,
  ).toEqual(['2026-10-15T09:00:00.000Z'])
})
it('supports numeric cron fields and fixed intervals', () => {
  expect(previewSchedule({ ...schedule, cron: '0 9 * * MON' }).supported).toBe(false)
  expect(
    previewSchedule({ ...schedule, mode: 'interval' }, Date.parse('2026-10-15T00:00:00Z'), 1).dates,
  ).toEqual(['2026-10-15T01:00:00.000Z'])
})
it('rejects invalid syntax and zones without crashing preview while distinguishing unsupported valid cron', () => {
  for (const cron of [
    '60 9 * * *',
    '0 24 * * *',
    '0 9 0 * *',
    '0 9 * 13 *',
    '0 9 * * 8',
    '*/0 * * * *',
    '0 9 20-10 * *',
    '0 9 * * MON',
    '0 0 9 * * *',
  ]) {
    expect(validCron(cron), cron).toBe(false)
    expect(scheduleIssue({ ...schedule, cron }, 'cron')).toBe('jobs.invalidCron')
  }
  for (const cron of ['0 9 * * *', '*/15 9-17 * * 1-5', '0,30 */2 1,15 1-12 *', '0\t9 * * *'])
    expect(validCron(cron), cron).toBe(true)
  expect(scheduleIssue({ ...schedule, concurrency: 1.5 }, 'concurrency')).toBe('jobs.invalidNumber')
  expect(scheduleIssue({ ...schedule, retries: 0 }, 'retries')).toBe(null)
  expect(previewSchedule({ ...schedule, timezone: 'Not/AZone' }).supported).toBe(false)
  expect(scheduleIssue({ ...schedule, cron: '*/15 9-17 * * 1-5' }, 'cron')).toBe(null)
  expect(previewSchedule({ ...schedule, cron: '*/15 9-17 * * 1-5' }).supported).toBe(true)
})
