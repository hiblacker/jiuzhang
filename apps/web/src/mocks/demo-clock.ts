import type { Model } from '@/shared/api/types'
import { api, unwrap } from '@/shared/api/client'

let inFlight: Promise<Model<'DemoClock'> | null> | null = null

/** Serialize browser-only clock ticks so the mock database sees one transition at a time. */
export function tickDemoClock(advanceSeconds: number, coalesce = false) {
  if (coalesce && inFlight) return inFlight
  const previous = inFlight
  const request = (async () => {
    if (previous) await previous
    return api
      .POST('/demo/tick', { body: { advanceSeconds } })
      .then((response) => unwrap(response).data)
      .catch((error) => {
        console.error('演示调度器推进失败', error)
        return null
      })
  })()
  inFlight = request
  void request.finally(() => {
    if (inFlight === request) inFlight = null
  })
  return request
}
