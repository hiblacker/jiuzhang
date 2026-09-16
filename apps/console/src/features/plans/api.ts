import type { ScopedRequest } from '../../api/client'
import type { Plan, Row } from '../../shared/types'

export interface PlanInput {
  sourceCode: string
  kind: string
  runtimeRef: string
  inventoryVersion: number | null
  startDate: string
  triggerTime: string
  timezone: string
  maxAttempts: number
  timeoutSeconds: number
  historicalRead: boolean
  contract: Row
  expectedVersion: number
}
export interface TriggerInput {
  plan: number
  day: string
  reason: string
  revision: boolean
}
export function planApi(call: ScopedRequest) {
  return {
    list: () => call<Plan[]>('lake/plans'),
    save: (input: PlanInput) => call('lake/plans', input),
    setState: (id: number, state: 'ACTIVE' | 'PAUSED') => call(`lake/plans/${id}/state`, { state }),
    trigger: ({ plan, ...body }: TriggerInput) => call(`lake/plans/${plan}/trigger`, body),
  }
}
