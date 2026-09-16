import type { ScopedRequest } from '../../api/client'
import type { Page, Row, Source } from '../../shared/types'

export interface SourceInput {
  code: string
  sourceType: string
  credentialRef: string
  config: Row
}
export function sourceApi(call: ScopedRequest) {
  return {
    list: (offset: number, limit = 50) =>
      call<Page<Source>>(`sources?limit=${limit}&offset=${offset}`),
    register: (input: SourceInput) => call('sources', input),
    async all() {
      const rows: Source[] = []
      for (let offset = 0; offset <= 100000; offset += 100) {
        const page = await call<Page<Source>>(`sources?limit=100&offset=${offset}`)
        rows.push(...page.items)
        if (page.items.length < 100) {
          break
        }
      }
      return rows
    },
  }
}
