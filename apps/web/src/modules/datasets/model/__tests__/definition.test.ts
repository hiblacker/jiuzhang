import { describe, expect, it } from 'vitest'
import type { Model } from '@/shared/api/types'
import { reconcileSqlFields, sourceFieldType } from '../definition'
const field = (name: string, type = 'string'): Model<'Field'> => ({
  name,
  target: name,
  type,
  nullable: true,
  output: true,
  sensitive: false,
  maskPolicyId: '',
  description: '',
})
describe('SQL result field reconciliation', () => {
  it('preserves order, renames, precision, output switches and masking for existing columns', () => {
    const edited = {
      ...field('amount', 'decimal(12,4)'),
      target: 'revenue',
      output: false,
      sensitive: true,
      maskPolicyId: '6001',
      description: '销售额',
    }
    const previous = [edited, field('id', 'integer'), field('removed')]
    const result = reconcileSqlFields(previous, [
      field('id', 'bigint'),
      field('amount', 'decimal(20,4)'),
      field('added', 'boolean'),
    ])
    expect(result.fields).toEqual([edited, field('id', 'integer'), field('added', 'boolean')])
    expect(result.removed).toEqual(['removed'])
    expect(result.added).toEqual(['added'])
    expect(result.fields[0]).not.toBe(edited)
    expect(previous).toHaveLength(3)
  })
  it('maps newly discovered database and executable types without losing decimal scale', () => {
    expect(
      ['bigint', 'integer', 'boolean', 'decimal(20,4)', 'datetime', 'date', 'varchar(40)'].map(
        sourceFieldType,
      ),
    ).toEqual(['integer', 'integer', 'boolean', 'decimal(20,4)', 'datetime', 'date', 'string'])
  })
})
