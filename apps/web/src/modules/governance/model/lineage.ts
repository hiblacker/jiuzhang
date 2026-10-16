import type { Model } from '@/shared/api/types'
export function lineageScope(
  edges: Model<'Edge'>[],
  roots: string[],
  direction: 'both' | 'upstream' | 'downstream',
) {
  const visible = new Set(roots)
  for (const side of direction === 'both' ? ['upstream', 'downstream'] : [direction]) {
    const queue = [...roots],
      seen = new Set(roots)
    while (queue.length) {
      const id = queue.pop()!
      const next = edges
        .filter((edge) => (side === 'upstream' ? edge.target === id : edge.source === id))
        .map((edge) => (side === 'upstream' ? edge.source : edge.target))
      for (const candidate of next) {
        visible.add(candidate)
        if (!seen.has(candidate)) {
          seen.add(candidate)
          queue.push(candidate)
        }
      }
    }
  }
  return visible
}

export function layoutLineage(nodes: Model<'Lineage'>['nodes'], edges: Model<'Edge'>[]) {
  const ids = new Set(nodes.map((node) => node.id))
  const children = new Map<string, string[]>()
  const remaining = new Map(nodes.map((node) => [node.id, 0]))
  const levels = new Map(
    nodes.map((node) => [node.id, { source: 0, dataset: 1, table: 2 }[node.kind]]),
  )
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue
    const targets = children.get(edge.source) ?? []
    targets.push(edge.target)
    children.set(edge.source, targets)
    remaining.set(edge.target, remaining.get(edge.target)! + 1)
  }
  const queue = nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id)
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!
    for (const target of children.get(id) ?? []) {
      levels.set(target, Math.max(levels.get(target)!, levels.get(id)! + 1))
      const pending = remaining.get(target)! - 1
      remaining.set(target, pending)
      if (!pending) queue.push(target)
    }
  }
  const rows = new Map<number, number>()
  return nodes.map((node) => {
    const level = levels.get(node.id)!
    const row = rows.get(level) ?? 0
    rows.set(level, row + 1)
    return { ...node, position: { x: level * 320, y: row * 120 } }
  })
}
