import type { Model } from '@/shared/api/types'
export function connectionIssue(
  nodes: Model<'Node'>[],
  edges: Model<'Edge'>[],
  source: string,
  target: string,
) {
  if (!nodes.some((node) => node.id === source) || !nodes.some((node) => node.id === target))
    return 'missing'
  if (source === target) return 'cycle'
  if (nodes.find((node) => node.id === target)?.type === 'input') return 'input'
  if (edges.some((edge) => edge.source === source && edge.target === target)) return 'duplicate'
  const queue = [target],
    visited = new Set<string>()
  while (queue.length) {
    const id = queue.pop()!
    if (id === source) return 'cycle'
    if (visited.has(id)) continue
    visited.add(id)
    queue.push(...edges.filter((edge) => edge.source === id).map((edge) => edge.target))
  }
  return ''
}
