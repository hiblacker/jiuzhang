export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export interface AuthSnapshot {
  base: string
  token: string
  generation: number
}

export function validateBase(value: string): string {
  const url = new URL(value.trim())
  if (
    url.username
    || url.password
    || url.search
    || url.hash
    || (url.protocol !== 'https:'
      && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new Error('控制 API 需要 HTTPS，本机可使用 HTTP')
  }
  return url.toString().replace(/\/+$/, '')
}

export function createTransport(
  readSession: () => AuthSnapshot,
  unauthorized: () => void,
  fetcher: typeof fetch = fetch,
) {
  const pending = new Set<AbortController>()
  function abort() {
    for (const controller of pending) {
      controller.abort()
    }
    pending.clear()
  }

  async function request<T>(
    route: string,
    body?: unknown,
    signal?: AbortSignal,
    csv = false,
  ): Promise<T> {
    const { generation, base, token } = readSession()
    const controller = new AbortController()
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(15000),
      ...(signal ? [signal] : []),
    ])
    pending.add(controller)
    // Response parsing is asynchronous too; recheck before changing any session or visible state.
    function current() {
      combined.throwIfAborted()
      if (generation !== readSession().generation) {
        throw new DOMException('Session changed', 'AbortError')
      }
    }
    try {
      current()
      const response = await fetcher(`${validateBase(base)}/api/v1/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        credentials: 'omit',
        signal: combined,
      })
      current()
      if (!response.ok) {
        const value = (await response.json().catch(() => ({}))) as { code?: unknown }
        current()
        if (response.status === 401) {
          unauthorized()
        }
        throw new ApiError(
          response.status,
          typeof value.code === 'string' ? value.code.slice(0, 200) : `HTTP_${response.status}`,
        )
      }
      const result = csv ? await response.blob() : await response.json()
      current()
      return result as T
    }
    finally {
      pending.delete(controller)
    }
  }
  return { request, abort }
}
