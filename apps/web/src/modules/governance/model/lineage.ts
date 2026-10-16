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
