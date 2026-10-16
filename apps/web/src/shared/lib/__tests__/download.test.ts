import { expect, it } from 'vitest'
import { safeDownloadName } from '../download'
it('preserves valid export names while neutralizing paths', () => {
  expect(safeDownloadName('jiuzhang-query-100001.csv')).toBe('jiuzhang-query-100001.csv')
  expect(safeDownloadName('../result.csv')).toBe('_result.csv')
  expect(safeDownloadName('...')).toBe('download.txt')
})
