import { describe, expect, it } from 'vitest'
import { CsvParseError, parseCsv, toCsv } from '../csv'

describe('CSV parsing and downloads', () => {
  it('preserves BOM, quoted commas, escaped quotes, multiline cells and empty values', () => {
    expect(parseCsv('\uFEFFid,name,note\r\n1,"demo, A","line 1\nline ""2"""\r\n2,,""')).toEqual([
      ['id', 'name', 'note'],
      ['1', 'demo, A', 'line 1\nline "2"'],
      ['2', '', ''],
    ])
  })

  it.each([
    ['id,name\n1,"unfinished', 'UNCLOSED_QUOTE'],
    ['id,name\n1,de"mo', 'UNEXPECTED_QUOTE'],
    ['id,name\n1,"demo"suffix', 'TRAILING_CHARACTERS'],
    ['id, id\n1,2', 'INVALID_HEADERS'],
    ['id,name\n1', 'COLUMN_COUNT'],
  ])('rejects malformed input without silently changing values: %s', (csv, code) => {
    expect(() => parseCsv(csv)).toThrow(CsvParseError)
    expect(() => parseCsv(csv)).toThrow(code)
  })

  it('exports safe formula-like cells with lossless quote and newline escaping', () => {
    expect(
      parseCsv(
        toCsv([{ name: 'demo, "A"', note: '=1+1', empty: null }], ['name', 'note', 'empty']),
      ),
    ).toEqual([
      ['name', 'note', 'empty'],
      ['demo, "A"', "'=1+1", ''],
    ])
  })
})
