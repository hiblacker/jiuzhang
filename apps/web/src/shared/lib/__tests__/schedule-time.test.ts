import { expect, it } from 'vitest'
import { nextScheduleTimes } from '../schedule-time'

const schedule = {
  mode: 'cron' as const,
  cron: '0 9 * * *',
  timezone: 'UTC',
  intervalMinutes: 60,
}

it('expands cron lists, ranges and steps in order', () => {
  expect(
    nextScheduleTimes(
      { ...schedule, cron: '0,30 9-10 * * *' },
      Date.parse('2026-01-01T08:59:00Z'),
      3,
    ).dates,
  ).toEqual(['2026-01-01T09:00:00.000Z', '2026-01-01T09:30:00.000Z', '2026-01-01T10:00:00.000Z'])
  expect(
    nextScheduleTimes(
      { ...schedule, cron: '*/20 9-10/1 * * *' },
      Date.parse('2026-01-01T08:59:00Z'),
      3,
    ).dates,
  ).toEqual(['2026-01-01T09:00:00.000Z', '2026-01-01T09:20:00.000Z', '2026-01-01T09:40:00.000Z'])
})

it('uses cron day-of-month and weekday OR rules when both are restricted', () => {
  expect(
    nextScheduleTimes({ ...schedule, cron: '0 0 1 * 1' }, Date.parse('2026-06-30T00:00:00Z'), 3)
      .dates,
  ).toEqual(['2026-07-01T00:00:00.000Z', '2026-07-06T00:00:00.000Z', '2026-07-13T00:00:00.000Z'])
})

it('skips nonexistent DST wall times and retains both repeated instants', () => {
  const newYork = { ...schedule, timezone: 'America/New_York' }
  expect(
    nextScheduleTimes({ ...newYork, cron: '30 2 * * *' }, Date.parse('2026-03-08T06:59:00Z'), 1)
      .dates,
  ).toEqual(['2026-03-09T06:30:00.000Z'])
  expect(
    nextScheduleTimes({ ...newYork, cron: '30 1 * * *' }, Date.parse('2026-11-01T05:20:00Z'), 2)
      .dates,
  ).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'])
})

it('handles leap days and fractional-hour time zones', () => {
  expect(
    nextScheduleTimes({ ...schedule, cron: '0 0 29 2 *' }, Date.parse('2025-01-01T00:00:00Z'), 1)
      .dates,
  ).toEqual(['2028-02-29T00:00:00.000Z'])
  expect(
    nextScheduleTimes(
      { ...schedule, cron: '0 9 * * *', timezone: 'Asia/Kathmandu' },
      Date.parse('2026-01-01T03:14:00Z'),
      1,
    ).dates,
  ).toEqual(['2026-01-01T03:15:00.000Z'])
})
