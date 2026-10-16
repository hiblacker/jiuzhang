/** Five-field numeric cron syntax. Quartz seconds, names and extensions are not accepted. */
export function validCron(expression: string): boolean {
  const fields = expression.trim().split(/\s+/)
  const bounds = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const
  if (fields.length !== bounds.length) return false
  return fields.every((field, index) => {
    const [min, max] = bounds[index]!
    return field.split(',').every((part) => {
      const match = /^(\*|[0-9]+(?:-[0-9]+)?)(?:\/([0-9]+))?$/.exec(part)
      if (!match) return false
      if (match[2] !== undefined && (Number(match[2]) < 1 || Number(match[2]) > max - min + 1))
        return false
      if (match[1] === '*') return true
      const [start, end = start] = match[1]!.split('-').map(Number)
      return start! >= min && end! <= max && start! <= end!
    })
  })
}

export function validTimeZone(value: string): boolean {
  if (!value.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}
