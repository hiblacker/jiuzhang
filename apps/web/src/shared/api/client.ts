import createClient from 'openapi-fetch'
import type { paths } from '@jiuzhang/contracts'
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public requestId: string,
    public details: string[] = [],
  ) {
    super(code)
  }
}
export const api = createClient<paths>({ baseUrl: import.meta.env.VITE_API_BASE_URL || '/api/v1' })
let csrfToken = ''
export function setCsrfToken(value: string) {
  csrfToken = value
}
api.use({
  onRequest({ request }) {
    if (csrfToken) request.headers.set('X-CSRF-Token', csrfToken)
    if (request.method !== 'GET' && !request.headers.has('Idempotency-Key'))
      request.headers.set('Idempotency-Key', crypto.randomUUID())
    return request
  },
})
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error || !result.response.ok) {
    const e = result.error as { error?: { code?: string; requestId?: string; details?: string[] } }
    throw new ApiError(
      e?.error?.code ?? 'NETWORK_ERROR',
      result.response.status,
      e?.error?.requestId ?? '',
      e?.error?.details ?? [],
    )
  }
  if (result.data === undefined) throw new ApiError('EMPTY_RESPONSE', 500, '')
  return result.data
}
