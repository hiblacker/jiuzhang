import type { Model } from '@/shared/api/types'
import { parseJsonObject } from '@/shared/lib/json'

function redact(value: unknown, key = ''): unknown {
  if (/authorization|cookie|password|passwd|secret|token|api[-_]?key/i.test(key))
    return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, redact(item, name)]),
    )
  return value
}

export function sanitizeSourceSettings(settings: Model<'SourceSettings'>): Model<'SourceSettings'> {
  return {
    ...settings,
    host: 'demo-db.invalid',
    baseUrl: 'https://demo-api.invalid',
    headers: JSON.stringify(redact(parseJsonObject(settings.headers)), null, 2),
    query: JSON.stringify(redact(parseJsonObject(settings.query)), null, 2),
    body: JSON.stringify(redact(parseJsonObject(settings.body)), null, 2),
  }
}
