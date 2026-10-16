import type { Model } from '@/shared/api/types'

function decimalParts(value: unknown) {
  const match = /^(-?)([0-9]+)(?:[.]([0-9]+))?$/.exec(String(value))
  if (!match) throw new Error('范围边界与数据应为十进制值')
  const fraction = match[3] ?? ''
  return { value: BigInt((match[1] ?? '') + match[2] + fraction), scale: fraction.length }
}
function compare(a: unknown, b: unknown) {
  const x = decimalParts(a),
    y = decimalParts(b),
    scale = Math.max(x.scale, y.scale)
  const left = x.value * 10n ** BigInt(scale - x.scale),
    right = y.value * 10n ** BigInt(scale - y.scale)
  return left < right ? -1 : Number(left > right)
}
export function qualityIssues(rule: Model<'QualityInput'>) {
  if (!rule.name.trim() || !rule.field.trim()) return ['名称与字段必填']
  if (rule.kind === 'range') {
    const bounds = rule.parameter.split(',').map((value) => value.trim())
    try {
      if (bounds.length !== 2 || compare(bounds[0], bounds[1]) > 0)
        return ['范围参数格式：最小值,最大值']
    } catch {
      return ['范围参数必须为两个有序十进制值']
    }
  }
  if (rule.kind === 'enum' && !rule.parameter.split(',').every((value) => value.trim()))
    return ['枚举参数为逗号分隔的非空值']
  if (
    rule.kind === 'freshness' &&
    (!/^[0-9]+$/.test(rule.parameter) ||
      Number(rule.parameter) < 1 ||
      Number(rule.parameter) > 87600)
  )
    return ['新鲜度为 1 至 87600 小时']
  return []
}
export function evaluateQuality(
  rule: Model<'Quality'>,
  rows: Model<'Row'>[],
  now: number,
  severity = rule.severity,
) {
  const issues = qualityIssues(rule)
  if (issues.length) throw new Error(issues.join('；'))
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = JSON.stringify(row[rule.field] ?? null)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const failedRows = rows.flatMap((row, index) => {
    const value = row[rule.field]
    let passed = true
    if (rule.kind === 'required')
      passed = value !== null && value !== undefined && String(value).trim() !== ''
    if (rule.kind === 'unique') passed = value != null && counts.get(JSON.stringify(value)) === 1
    if (rule.kind === 'range') {
      const [min, max] = rule.parameter.split(',').map((value) => value.trim())
      try {
        passed = compare(value, min) >= 0 && compare(value, max) <= 0
      } catch {
        passed = false
      }
    }
    if (rule.kind === 'enum')
      passed = rule.parameter
        .split(',')
        .map((value) => value.trim())
        .includes(String(value))
    if (rule.kind === 'freshness') {
      const date = Date.parse(String(value)),
        age = now - date
      passed = Number.isFinite(date) && age >= 0 && age <= Number(rule.parameter) * 3600000
    }
    return passed ? [] : [index + 1]
  })
  const failed = failedRows.length,
    total = rows.length
  return {
    ruleId: rule.id,
    version: rule.version,
    result: failed ? severity : ('PASS' as const),
    message: total + ' 条合成样本，' + failed + ' 条不符合规则',
    total,
    failed,
    passRate: total ? ((total - failed) / total) * 100 : 100,
    failedRows,
  }
}
export function qualityScenario(
  rule: Model<'Quality'>,
  scenario: 'pass' | 'warn' | 'block',
  now: number,
) {
  const examples: Record<Model<'Quality'>['kind'], Model<'Row'>[string][]> = {
    required: ['sample-a', 'sample-b', 'sample-c'],
    unique: ['100', '101', '102'],
    range: Array(3).fill(rule.parameter.split(',')[0]?.trim() ?? '0'),
    enum: Array(3).fill(rule.parameter.split(',')[0]?.trim() ?? ''),
    freshness: Array(3).fill(new Date(now).toISOString()),
  }
  const rows = examples[rule.kind].map((value) => ({ [rule.field]: value }))
  if (scenario !== 'pass')
    rows[1]![rule.field] = rule.kind === 'unique' ? rows[0]![rule.field] : null
  return { ...evaluateQuality(rule, rows, now, scenario === 'warn' ? 'WARN' : 'BLOCK'), rows }
}
