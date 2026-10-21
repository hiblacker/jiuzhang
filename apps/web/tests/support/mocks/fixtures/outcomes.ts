import type { Model } from '@/shared/api/types'

// Failure injection belongs to the test fixture, never to a business request.
export const testOutcomes: {
  run: Model<'RunOutcome'>
  import: 'succeeded' | 'failed'
  export: 'ready' | 'failed'
} = { run: 'succeeded', import: 'succeeded', export: 'ready' }

export function resetTestOutcomes() {
  Object.assign(testOutcomes, { run: 'succeeded', import: 'succeeded', export: 'ready' })
}
