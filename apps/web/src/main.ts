import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { queryClient } from './app/query-client'
import { createPinia } from 'pinia'
import App from './app/App.vue'
import { router } from './app/router'
import { i18n } from './app/i18n'
import './styles.css'
import type { Model } from './shared/api/types'
async function bootstrap() {
  let controls: (() => void) | undefined
  if (import.meta.env.VITE_API_MODE === 'mock') {
    const { startMocking } = await import('./mocks/browser')
    controls = await startMocking((clock: Model<'DemoClock'>) => {
      window.dispatchEvent(new CustomEvent('demo-clock-change', { detail: clock }))
      if (!clock.changed) return
      void Promise.all(
        ['tasks', 'runs', 'overview', 'warehouse', 'governance', 'datasets', 'services'].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    })
  }
  const app = createApp(App)
  app.use(createPinia())
  app.use(i18n)
  app.use(router)
  app.use(VueQueryPlugin, {
    queryClient,
  })
  await router.isReady()
  app.mount('#app')
  controls?.()
}
void bootstrap().catch((error) => {
  const root = document.getElementById('app')
  if (root) {
    root.textContent = i18n.global.t('startupFailed')
    console.error(error)
  }
})
