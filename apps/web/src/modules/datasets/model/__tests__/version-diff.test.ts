import { describe, it, expect } from 'vitest'
import type { Model } from '@/shared/api/types'
import { compareVersionFields } from '../version-diff'
const field = (name: string): Model<'Field'> => ({
  name,
  target: name,
  type: 'string',
  nullable: true,
  output: true,
  sensitive: false,
  maskPolicyId: '',
  description: '',
})
describe('version field differences', () => {
  it('includes additions, removals, reordering and policy changes in draft direction', () => {
    const before = [field('id'), field('phone'), field('legacy')]
    const after = [
      { ...field('phone'), maskPolicyId: '6001', output: false },
      field('id'),
      field('new'),
    ]
    const result = compareVersionFields(before, after)
    expect(result.find((row) => row.name === 'phone')?.changes).toEqual([
      'output',
      'maskPolicyId',
      'order',
    ])
    expect(result.find((row) => row.name === 'legacy')?.status).toBe('removed')
    expect(result.find((row) => row.name === 'new')?.status).toBe('added')
    expect(result.find((row) => row.name === 'id')?.changes).toEqual(['order'])
    expect(before[1]?.maskPolicyId).toBe('')
  })
  it('matches repeated source names once and compares every field attribute', () => {
    const first = field('amount'),
      second = { ...field('amount'), target: 'amount_copy' }
    expect(compareVersionFields([first, second], [first, second]).map((row) => row.status)).toEqual(
      ['unchanged', 'unchanged'],
    )
    expect(
      compareVersionFields(
        [first],
        [
          {
            ...first,
            target: 'total',
            type: 'decimal(10,2)',
            nullable: false,
            sensitive: true,
            description: 'updated',
          },
        ],
      )[0]?.changes,
    ).toEqual(['target', 'type', 'nullable', 'sensitive', 'description'])
  })
})
