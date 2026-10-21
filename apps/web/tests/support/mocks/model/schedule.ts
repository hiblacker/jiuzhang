import type { Model } from '@/shared/api/types'
import type { MockState } from '../fixtures/seed'
import { validCron, validTimeZone } from '@/shared/lib/cron'

export function scheduleIssues(
  state: MockState,
  id: string,
  schedule: Model<'Schedule'>,
): string[] {
  const issues: string[] = []
  if (!validTimeZone(schedule.timezone)) issues.push('请选择有效的 IANA 时区')
  if (schedule.mode === 'cron' && !validCron(schedule.cron))
    issues.push('请输入合法的五字段数字 Cron；不支持 Quartz 扩展')
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function cycle(current: string): boolean {
    if (current === id || visiting.has(current)) return true
    if (visited.has(current)) return false
    const task = state.tasks.find((task) => task.id === current)
    if (!task) {
      issues.push('依赖任务不存在：' + current)
      return false
    }
    visiting.add(current)
    const cyclic = task.schedule.dependencies.some(cycle)
    visiting.delete(current)
    visited.add(current)
    return cyclic
  }
  if (schedule.dependencies.some(cycle)) issues.push('任务依赖存在循环或依赖自身')
  return issues
}
