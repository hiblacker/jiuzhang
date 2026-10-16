import type { Model } from '@/shared/api/types'

type Field = Model<'Field'>
export type FieldChange = keyof Field | 'order'
export interface FieldDifference {
  key: string
  name: string
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  before?: Field
  after?: Field
  changes: FieldChange[]
}

/** Compare from the historical version to the current draft; repeated source fields retain order. */
export function compareVersionFields(before: Field[], after: Field[]): FieldDifference[] {
  const used = new Set<number>()
  const differences: FieldDifference[] = before.map((field, index) => {
    const nextIndex = after.findIndex((next, i) => !used.has(i) && next.name === field.name)
    if (nextIndex < 0)
      return {
        key: 'removed-' + index,
        name: field.name,
        status: 'removed',
        before: field,
        changes: [],
      }
    used.add(nextIndex)
    const next = after[nextIndex]!
    const changes: FieldChange[] = (Object.keys(field) as (keyof Field)[]).filter(
      (key) => field[key] !== next[key],
    )
    if (index !== nextIndex) changes.push('order')
    return {
      key: 'matched-' + index,
      name: field.name,
      status: changes.length ? 'changed' : 'unchanged',
      before: field,
      after: next,
      changes,
    }
  })
  after.forEach((field, index) => {
    if (!used.has(index))
      differences.push({
        key: 'added-' + index,
        name: field.name,
        status: 'added',
        after: field,
        changes: [],
      })
  })
  return differences
}
