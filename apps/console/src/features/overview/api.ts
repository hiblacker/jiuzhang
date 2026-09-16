import type { ScopedRequest } from '../../api/client'

export interface Summary {
  runs?: { run_count?: number, complete_count?: number }
  objects?: { row_count?: number, failed_object_count?: number }
}
export interface SystemRun {
  id: number
  source_code: string
  mode: string
  scheduled_window_start: string
  state: string
  error_code?: string
}
export interface Delivery {
  source_code: string
  delivery_kind: string
  scheduled_window_start: string
  observed_state: string
  received_at?: string
}
export function overviewApi(call: ScopedRequest) {
  return {
    async load(source: string) {
      const query = source.trim() ? `sourceCode=${encodeURIComponent(source.trim())}&` : ''
      const [summary, runs, deliveries] = await Promise.all([
        call<Summary>(`lake/summary?${query}`),
        call<SystemRun[]>(`lake/runs?${query}limit=50`),
        call<Delivery[]>(`lake/deliveries?${query}limit=50`),
      ])
      return { summary, runs, deliveries }
    },
  }
}
