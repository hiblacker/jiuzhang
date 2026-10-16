import type { Model } from '@/shared/api/types'

/** Deterministic sample operations; this is not a SQL or warehouse engine. */
export function orderedNodes(definition: Model<'DatasetDefinition'>) {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]))
  if (!nodes.size || nodes.size !== definition.nodes.length)
    throw new Error('加工图必须有节点且 ID 不重复')
  const incoming = new Map(definition.nodes.map((node) => [node.id, 0]))
  for (const edge of definition.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) throw new Error('连线引用不存在的节点')
    incoming.set(edge.target, incoming.get(edge.target)! + 1)
  }
  const queue = definition.nodes.filter((node) => incoming.get(node.id) === 0)
  const result: Model<'Node'>[] = []
  while (queue.length) {
    const node = queue.shift()!
    result.push(node)
    for (const edge of definition.edges.filter((edge) => edge.source === node.id)) {
      const remaining = incoming.get(edge.target)! - 1
      incoming.set(edge.target, remaining)
      if (remaining === 0) queue.push(nodes.get(edge.target)!)
    }
  }
  if (result.length !== definition.nodes.length) throw new Error('加工图存在循环依赖')
  return result
}

export function convertValue(
  value: Model<'Row'>[string],
  field: Model<'Field'>,
): Model<'Row'>[string] {
  if (value === null || value === undefined) {
    if (!field.nullable) throw new Error(field.name + ' 不允许空值')
    return null
  }
  const text = String(value).trim()
  if (field.type === 'string') return String(value)
  if (field.type === 'integer') {
    if (!/^-?[0-9]+$/.test(text)) throw new Error(field.name + ' 无法转换为整数')
    const integer = BigInt(text)
    return integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(integer)
      : String(integer)
  }
  const decimal = /^decimal[(]([0-9]+),([0-9]+)[)]$/.exec(field.type)
  if (decimal) {
    const precision = Number(decimal[1]),
      scale = Number(decimal[2])
    const match = /^(-?)([0-9]+)(?:[.]([0-9]+))?$/.exec(text)
    if (!match || scale > precision || precision > 38) throw new Error(field.name + ' 小数格式无效')
    const whole = match[2]!.replace(/^0+(?=[0-9])/, ''),
      fraction = match[3] ?? ''
    if (fraction.length > scale || whole.replace(/^0$/, '').length > precision - scale)
      throw new Error(field.name + ' 超出精度或小数位，未截断数据')
    return (match[1] ?? '') + whole + (scale ? '.' + fraction.padEnd(scale, '0') : '')
  }
  if (field.type === 'boolean') {
    if (value === true || text === 'true' || text === '1') return true
    if (value === false || text === 'false' || text === '0') return false
    throw new Error(field.name + ' 无法转换为布尔值')
  }
  if (field.type === 'date') {
    if (
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text) ||
      !Number.isFinite(Date.parse(text)) ||
      new Date(text).toISOString().slice(0, 10) !== text
    )
      throw new Error(field.name + ' 日期应为有效 YYYY-MM-DD')
    return text
  }
  throw new Error('不支持的字段类型：' + field.type)
}

/** Each node consumes only its incoming edges; branches remain independent. */
export function executeGraph(
  definition: Model<'DatasetDefinition'>,
  input: Model<'Row'>[],
  resolveInput: (config: string) => Model<'Row'>[],
) {
  const results = new Map<string, Model<'Row'>[]>()
  for (const node of orderedNodes(definition)) {
    const parents = definition.edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => results.get(edge.source)!)
    if (node.type === 'input') {
      if (parents.length) throw new Error('输入节点不能有上游连线')
      results.set(
        node.id,
        structuredClone(node.config.trim() ? resolveInput(node.config.trim()) : input),
      )
      continue
    }
    const multi = node.type === 'join' || node.type === 'union'
    if (
      (!multi && parents.length !== 1) ||
      (node.type === 'join' && parents.length !== 2) ||
      (node.type === 'union' && parents.length < 2)
    )
      throw new Error(node.label + ' 的输入连线数量不合法')
    let rows = structuredClone(parents[0]!)
    if (node.type === 'filter') {
      const separator = node.config.indexOf('=')
      if (separator < 1) throw new Error('过滤格式：字段=值')
      const field = node.config.slice(0, separator).trim(),
        value = node.config.slice(separator + 1).trim()
      rows = rows.filter((row) => String(row[field]) === value)
    }
    if (node.type === 'fields' && node.config.trim()) {
      const columns = node.config.split(',').map((field) => field.trim())
      if (columns.some((field) => !field) || new Set(columns).size !== columns.length)
        throw new Error('字段配置应为不重复的逗号分隔字段名')
      rows = rows.map((row) =>
        Object.fromEntries(
          columns.map((field) => {
            if (!(field in row)) throw new Error('字段不存在：' + field)
            return [field, row[field]]
          }),
        ),
      )
    }
    if (node.type === 'union') {
      if (!['all', 'distinct'].includes(node.config))
        throw new Error('Union 配置必须为 all 或 distinct')
      const columns = Object.keys(parents.flat()[0] ?? {}).sort()
      if (
        parents
          .flat()
          .some((row) => JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(columns))
      )
        throw new Error('Union 两侧字段结构必须相同')
      rows = structuredClone(parents.flat())
      if (node.config === 'distinct') {
        const seen = new Set<string>()
        rows = rows.filter((row) => {
          const key = JSON.stringify(columns.map((column) => row[column]))
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      }
    }
    if (node.type === 'join') {
      const match = /^(inner|left):([a-zA-Z_][a-zA-Z0-9_]*)=([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(
        node.config.trim(),
      )
      if (!match) throw new Error('Join 配置示例：left:id=id；右侧字段以 right_ 为前缀')
      const [, kind, leftKey, rightKey] = match
      const right = parents[1]!,
        rightFields = [...new Set(right.flatMap((row) => Object.keys(row)))]
      if (rows.some((row) => !(leftKey! in row)) || right.some((row) => !(rightKey! in row)))
        throw new Error('Join 关联字段不存在')
      rows = rows.flatMap((left) => {
        const matches = right.filter(
          (row) =>
            left[leftKey!] != null && row[rightKey!] != null && left[leftKey!] === row[rightKey!],
        )
        if (!matches.length && kind === 'left')
          return [
            {
              ...left,
              ...Object.fromEntries(rightFields.map((field) => ['right_' + field, null])),
            },
          ]
        return matches.map((row) => ({
          ...left,
          ...Object.fromEntries(Object.entries(row).map(([key, value]) => ['right_' + key, value])),
        }))
      })
    }
    if (node.type === 'aggregate') {
      const match = /^sum:([a-zA-Z_][a-zA-Z0-9_]*)(?: by ([a-zA-Z_][a-zA-Z0-9_]*))?$/.exec(
        node.config.trim(),
      )
      if (!match) throw new Error('聚合配置示例：sum:amount 或 sum:amount by city')
      const field = match[1]!,
        group = match[2],
        groups = new Map<string, Model<'Row'>[]>()
      for (const row of rows) {
        if (!(field in row) || (group && !(group in row))) throw new Error('聚合字段不存在')
        const key = JSON.stringify(group ? row[group] : null)
        groups.set(key, [...(groups.get(key) ?? []), row])
      }
      rows = [...groups.values()].map((groupRows) => ({
        ...(group ? { [group]: groupRows[0]![group] ?? null } : {}),
        [field]: sumDecimal(groupRows.map((row) => row[field])),
      }))
    }
    results.set(node.id, rows)
  }
  const sinks = definition.nodes.filter(
    (node) => !definition.edges.some((edge) => edge.source === node.id),
  )
  if (sinks.length !== 1) throw new Error('加工图需要唯一输出；请连接分支至 Join 或 Union 节点')
  return results.get(sinks[0]!.id)!
}

export function maskValue(value: Model<'Row'>[string], policy?: Model<'Masking'>) {
  if (value === null || value === undefined) return null
  if (policy?.kind === 'remove') return null
  if (policy?.kind === 'generalize') return policy.parameter || '已泛化'
  const [prefix = 3, suffix = 4] = (policy?.parameter ?? '3,4').split(',').map(Number)
  if (!Number.isInteger(prefix) || !Number.isInteger(suffix) || prefix < 0 || suffix < 0)
    throw new Error('掩码参数应为非负整数：保留前缀,保留后缀')
  const text = String(value)
  if (prefix + suffix >= text.length) return '*'.repeat(text.length)
  return (
    text.slice(0, prefix) +
    '*'.repeat(text.length - prefix - suffix) +
    (suffix ? text.slice(-suffix) : '')
  )
}

export function sumDecimal(values: Model<'Row'>[string][]) {
  let cents = 0n
  for (const value of values) {
    if (value === null) continue
    const match = /^(-?)([0-9]+)(?:[.]([0-9]{1,2}))?$/.exec(String(value))
    if (!match) throw new Error('金额必须是最多两位小数的十进制字符串')
    const magnitude = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))
    cents += match[1] ? -magnitude : magnitude
  }
  const absolute = cents < 0n ? -cents : cents
  return (
    (cents < 0n ? '-' : '') +
    String(absolute / 100n) +
    '.' +
    String(absolute % 100n).padStart(2, '0')
  )
}

export function mergeOutput(
  previous: Model<'Row'>[],
  incoming: Model<'Row'>[],
  output: Model<'Output'>,
) {
  if (output.writeMode === 'replace') return structuredClone(incoming)
  if (output.writeMode === 'append') return structuredClone([...previous, ...incoming])
  if (!output.keys.length) throw new Error('主键更新需要至少一个业务主键')
  const keyOf = (row: Model<'Row'>) => {
    if (output.keys.some((key) => row[key] === null || row[key] === undefined || row[key] === ''))
      throw new Error('业务主键不能缺失或为空')
    return JSON.stringify(output.keys.map((key) => row[key]))
  }
  const rows = new Map(previous.map((row) => [keyOf(row), row]))
  for (const row of incoming) rows.set(keyOf(row), row)
  return structuredClone([...rows.values()])
}
