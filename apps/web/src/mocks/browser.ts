import { setupWorker } from 'msw/browser'
import { HttpNetworkFrame } from 'msw/experimental'
import { createApp } from 'vue'
import { handlers } from './handlers'
import { seedReady } from './db'
import MockControls from './ui/MockControls.vue'
import { tickDemoClock } from './demo-clock'
import type { Model } from '@/shared/api/types'

type ClockChange = (clock: Model<'DemoClock'>) => void

export async function startMocking(onClockChange?: ClockChange) {
  await seedReady()
  const worker = setupWorker(...handlers)
  await worker.start({
    quiet: true,
    onUnhandledFrame({ frame, defaults }) {
      if (
        frame instanceof HttpNetworkFrame &&
        new URL(frame.data.request.url).pathname.startsWith('/api/')
      )
        defaults.error()
    },
  })
  let stopped = false
  const tick = async (advanceSeconds: number) => {
    if (stopped || document.visibilityState !== 'visible') return
    const clock = await tickDemoClock(advanceSeconds, true)
    if (clock) onClockChange?.(clock)
  }
  const timer = window.setInterval(() => void tick(0), 1000)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void tick(0)
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  const cleanup = () => {
    if (stopped) return
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    void worker.stop()
  }
  import.meta.hot?.dispose(cleanup)
  return () => {
    const node = document.createElement('div')
    document.body.append(node)
    createApp(MockControls, { onClockChange }).mount(node)
  }
}
