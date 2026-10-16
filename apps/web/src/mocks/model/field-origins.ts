import type { Model } from '@/shared/api/types'
import { orderedNodes } from './dataset-runtime'

export type FieldOrigins = Map<string, Set<string>>

/** Propagates explicit field origins through the supported demo graph and SQL presets. */
export function resolveFieldOrigins(
  definition: Model<'DatasetDefinition'>,
  input: FieldOrigins,
  resolveInput: (objectId: string) => FieldOrigins,
): FieldOrigins {
  let fields: FieldOrigins
  if (definition.mode === 'sql') {
    if (definition.sql.trim() === 'SELECT * FROM orders LIMIT 12') fields = input
    else if (definition.sql.trim() === 'SELECT id, customer, amount FROM orders LIMIT 12')
      fields = new Map([...input].filter(([name]) => ['id', 'customer', 'amount'].includes(name)))
    else throw new Error('SQL 超出预设范围，字段依赖未解析')
  } else {
    const outputs = new Map<string, FieldOrigins>()
    for (const node of orderedNodes(definition)) {
      const parents = definition.edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => outputs.get(edge.source)!)
      let result: FieldOrigins
      if (node.type === 'input')
        result = node.config.trim() ? resolveInput(node.config.trim()) : input
      else {
        if (!parents.length) throw new Error('加工节点缺少输入')
        result = new Map([...parents[0]!].map(([name, origins]) => [name, new Set(origins)]))
        if (node.type === 'fields' && node.config.trim()) {
          const selected = node.config.split(',').map((name) => name.trim())
          result = new Map([...result].filter(([name]) => selected.includes(name)))
        }
        if (node.type === 'join') {
          if (parents.length !== 2) throw new Error('Join 输入数量不合法')
          for (const [name, origins] of parents[1]!) result.set('right_' + name, new Set(origins))
        }
        if (node.type === 'union') {
          for (const parent of parents.slice(1))
            for (const [name, origins] of parent)
              result.set(name, new Set([...(result.get(name) ?? []), ...origins]))
        }
        if (node.type === 'aggregate') {
          const match = /^sum:([a-zA-Z_][a-zA-Z0-9_]*)(?: by ([a-zA-Z_][a-zA-Z0-9_]*))?$/.exec(
            node.config.trim(),
          )
          if (!match) throw new Error('聚合配置超出解析范围')
          result = new Map([...result].filter(([name]) => name === match[1] || name === match[2]))
        }
      }
      outputs.set(node.id, result)
    }
    const sinks = definition.nodes.filter(
      (node) => !definition.edges.some((edge) => edge.source === node.id),
    )
    if (sinks.length !== 1) throw new Error('加工图没有唯一输出')
    fields = outputs.get(sinks[0]!.id)!
  }
  return fields
}
