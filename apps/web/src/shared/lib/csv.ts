export class CsvParseError extends Error {
  constructor(
    readonly code:
      | 'TRAILING_CHARACTERS'
      | 'UNEXPECTED_QUOTE'
      | 'UNCLOSED_QUOTE'
      | 'MISSING_DATA'
      | 'INVALID_HEADERS'
      | 'COLUMN_COUNT',
  ) {
    super(code)
    this.name = 'CsvParseError'
  }
}
const LF = String.fromCharCode(10),
  CR = String.fromCharCode(13),
  BOM = String.fromCharCode(65279)
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false,
    afterQuote = false
  const input = text.startsWith(BOM) ? text.slice(1) : text
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') {
        quoted = false
        afterQuote = true
      } else cell += c
      continue
    }
    if (afterQuote && c !== ',' && c !== LF && c !== CR)
      throw new CsvParseError('TRAILING_CHARACTERS')
    if (c === '"') {
      if (cell !== '') throw new CsvParseError('UNEXPECTED_QUOTE')
      quoted = true
    } else if (c === ',') {
      row.push(cell)
      cell = ''
      afterQuote = false
    } else if (c === LF || c === CR) {
      if (c === CR && input[i + 1] === LF) i++
      row.push(cell)
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
      cell = ''
      afterQuote = false
    } else cell += c
  }
  if (quoted) throw new CsvParseError('UNCLOSED_QUOTE')
  row.push(cell)
  if (row.some((x) => x !== '')) rows.push(row)
  if (rows.length < 2) throw new CsvParseError('MISSING_DATA')
  if (
    new Set(rows[0]!.map((name) => name.trim())).size !== rows[0]!.length ||
    rows[0]!.some((x) => !x.trim())
  )
    throw new CsvParseError('INVALID_HEADERS')
  if (rows.some((r) => r.length !== rows[0]!.length)) throw new CsvParseError('COLUMN_COUNT')
  return rows
}
export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value)
  if (['=', '+', '@', '-'].includes(text.trimStart().charAt(0))) text = "'" + text
  return '"' + text.replaceAll('"', '""') + '"'
}
export function toCsv(rows: Record<string, unknown>[], columns: string[]) {
  return (
    BOM +
    [
      columns.map(csvCell).join(','),
      ...rows.map((row) => columns.map((k) => csvCell(row[k])).join(',')),
    ].join(CR + LF)
  )
}
