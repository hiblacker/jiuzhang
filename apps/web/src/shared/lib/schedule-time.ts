import { validCron, validTimeZone } from './cron'

interface Timing {
  mode: 'manual' | 'cron' | 'interval'
  cron: string
  timezone: string
  intervalMinutes: number
}

function expand(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepText] = part.split('/')
    const step = Number(stepText ?? 1)
    const [startText, endText] = range!.split('-')
    const start = startText === '*' ? min : Number(startText)
    const end = startText === '*' || (stepText && !endText) ? max : Number(endText ?? startText)
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

/** Numeric five-field Cron in an IANA zone. Missing DST times are skipped;
 * repeated wall times retain distinct UTC instants. Search is bounded to eight years. */
export function nextScheduleTimes(schedule: Timing, from = Date.now(), count = 3) {
  const dates: string[] = []
  if (
    !validTimeZone(schedule.timezone) ||
    !Number.isFinite(from) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10
  )
    return { dates, supported: false }
  if (schedule.mode === 'manual') return { dates, supported: true }
  if (schedule.mode === 'interval') {
    if (
      !Number.isInteger(schedule.intervalMinutes) ||
      schedule.intervalMinutes < 1 ||
      schedule.intervalMinutes > 525600
    )
      return { dates, supported: false }
    return {
      dates: Array.from({ length: count }, (_, i) =>
        new Date(from + (i + 1) * schedule.intervalMinutes * 60000).toISOString(),
      ),
      supported: true,
    }
  }
  if (!validCron(schedule.cron)) return { dates, supported: false }
  const fields = schedule.cron.trim().split(/\s+/)
  const minute = expand(fields[0]!, 0, 59),
    hour = expand(fields[1]!, 0, 23)
  const day = expand(fields[2]!, 1, 31),
    month = expand(fields[3]!, 1, 12),
    weekday = expand(fields[4]!, 0, 7)
  if (weekday.has(7)) weekday.add(0)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  })
  const parts = (time: number) =>
    Object.fromEntries(formatter.formatToParts(time).map((p) => [p.type, Number(p.value)]))
  const matchesDay = (p: Record<string, number>) => {
    if (!month.has(p.month!)) return false
    const d = day.has(p.day!),
      w = weekday.has(new Date(Date.UTC(p.year!, p.month! - 1, p.day!)).getUTCDay())
    return fields[2]!.startsWith('*') || fields[4]!.startsWith('*') ? d && w : d || w
  }
  const start = Math.floor(from / 60000) * 60000 + 60000
  const limit = from + 8 * 366 * 86400000
  for (
    let block = Math.floor(start / 3600000) * 3600000;
    block <= limit && dates.length < count;
    block += 3600000
  ) {
    const first = parts(block),
      last = parts(block + 59 * 60000)
    if (
      !(matchesDay(first) && hour.has(first.hour!)) &&
      !(matchesDay(last) && hour.has(last.hour!))
    )
      continue
    for (
      let time = Math.max(start, block);
      time < block + 3600000 && time <= limit && dates.length < count;
      time += 60000
    ) {
      const p = parts(time)
      if (matchesDay(p) && hour.has(p.hour!) && minute.has(p.minute!))
        dates.push(new Date(time).toISOString())
    }
  }
  return { dates, supported: true }
}
