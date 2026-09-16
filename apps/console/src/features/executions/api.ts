import type { ScopedRequest } from '../../api/client'
import type { Row } from '../../shared/types'

export interface Execution {
  id: number
  source_code: string
  business_date: string
  attempt: number
  state: string
  kind: string
  error_code?: string | null
  result?: { assets?: { kind: string }[], schemaChange?: Row }
}
export interface DeliveryWindow {
  source_code: string
  business_date: string
  revision: number
  state: string
  reason?: string
}
export function executionApi(call: ScopedRequest) {
  const query = (plan: number | null) => (plan ? `?planId=${plan}` : '')
  return {
    list: (plan: number | null) => call<Execution[]>(`lake/executions${query(plan)}`),
    windows: (plan: number | null) => call<DeliveryWindow[]>(`lake/windows${query(plan)}`),
    reconcile: () => call('lake/calendar/reconcile', {}),
    retry: (id: number) => call(`lake/executions/${id}/retry`, {}),
    cancel: (id: number) => call(`lake/executions/${id}/cancel`, {}),
    reprocess: (id: number) => call(`lake/executions/${id}/reprocess`, {}),
    approveSchema: (id: number, reason: string) =>
      call(`lake/executions/${id}/approve-schema`, { reason }),
  }
}
