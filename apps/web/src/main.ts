import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { queryClient } from './app/query-client'
import { createPinia } from 'pinia'
import App from './app/App.vue'
import { router } from './app/router'
import { i18n } from './app/i18n'
import './styles.css'
async function bootstrap() {
  const app = createApp(App)
  app.use(createPinia())
  app.use(i18n)
  app.use(router)
  app.use(VueQueryPlugin, {
    queryClient,
  })
  await router.isReady()
  app.mount('#app')
}
void bootstrap().catch((error) => {
  const root = document.getElementById('app')
  if (root) {
    root.textContent = i18n.global.t('startupFailed')
    console.error(error)
  }
})
