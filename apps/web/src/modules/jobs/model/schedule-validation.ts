import type { Model } from '@/shared/api/types'
import { validCron, validTimeZone } from '@/shared/lib/cron'

export function scheduleIssue(schedule: Model<'Schedule'>, field: keyof Model<'Schedule'>) {
  const value = schedule[field]
  const limits = {
    intervalMinutes: [1, 525600],
    retries: [0, 10],
    timeoutSeconds: [1, 86400],
    concurrency: [1, 10],
  } as const
  if (field in limits) {
    const [min, max] = limits[field as keyof typeof limits]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
      return 'jobs.invalidNumber'
  }
  if (field === 'cron' && schedule.mode === 'cron' && !validCron(schedule.cron))
    return 'jobs.invalidCron'
  if (field === 'timezone' && !validTimeZone(schedule.timezone)) return 'jobs.invalidTimezone'
  if (
    field === 'dependencies' &&
    new Set(schedule.dependencies).size !== schedule.dependencies.length
  )
    return 'jobs.invalidDependencies'
  return null
}
