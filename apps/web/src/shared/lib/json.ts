/** Parse a configuration object without accepting arrays, primitives or null. */
export function parseJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Expected a JSON object')
  return parsed as Record<string, unknown>
}
