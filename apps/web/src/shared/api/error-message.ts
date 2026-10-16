import { ApiError } from './client'
export function errorKey(error: unknown) {
  const known = [
    'NETWORK_ERROR',
    'DEMO_ERROR',
    'FORBIDDEN',
    'NOT_FOUND',
    'DEPENDENCY_CONFLICT',
    'DUPLICATE_NAME',
    'VALIDATION_ERROR',
    'INTERNAL_ERROR',
    'STORAGE_FULL',
    'STORAGE_UNAVAILABLE',
    'IDEMPOTENCY_CONFLICT',
    'NOT_IMPLEMENTED',
  ]
  const code = error instanceof ApiError ? error.code : 'NETWORK_ERROR'
  return 'errors.' + (known.includes(code) ? code : 'UNKNOWN')
}
