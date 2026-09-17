// The single HTTP client for the console: browser session cookie plus CSRF, one error shape and
// one place that knows how to reach the control API. Domain modules may wrap it later; nothing
// else in the application is allowed to call fetch directly.
let csrf: { headerName: string; token: string } | null = null;

export class ApiError extends Error {
  // Explicit fields instead of parameter properties: plain Node can type-strip this file, which
  // keeps api/http.ts usable from the unit tests without a build step.
  status: number;
  code: string;
  requestId: string;

  constructor(status: number, code: string, message: string, requestId = '') {
    super(message === code ? message : `${message} (${code})`);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export async function csrfToken() {
  const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('暂时无法连接服务');
  csrf = (await response.json()) as { headerName: string; token: string };
  return csrf;
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown, form = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    const token = csrf || (await csrfToken());
    headers[token.headerName] = token.token;
    headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
  }
  const response = await fetch(`/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : form ? String(body) : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    if (response.status === 403) csrf = null;
    throw new ApiError(
      response.status,
      error.code || 'REQUEST_FAILED',
      error.message || '操作未成功',
      error.requestId || response.headers.get('X-Request-Id') || '',
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function login(username: string, password: string) {
  await csrfToken();
  await api('/auth/login', new URLSearchParams({ username, password }), true);
  await csrfToken();
}

export async function logout() {
  await api('/auth/logout', {});
  csrf = null;
}

export async function exportCsv(path: string, body: unknown, filename: string) {
  const token = csrf || (await csrfToken());
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', [token.headerName]: token.token },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    throw new ApiError(response.status, error.code || 'EXPORT_FAILED', error.message || '导出失败');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
