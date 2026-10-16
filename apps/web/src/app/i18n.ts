import { createI18n } from 'vue-i18n'
import common from '@/shared/i18n/zh-CN'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': common },
})

// These public entries expose dictionaries only, so navigation does not preload editors.
const loaders = {
  sources: () => import('@/modules/sources/locales'),
  datasets: () => import('@/modules/datasets/locales'),
  jobs: () => import('@/modules/jobs/locales'),
  warehouse: () => import('@/modules/warehouse/locales'),
  governance: () => import('@/modules/governance/locales'),
  services: () => import('@/modules/services/locales'),
  identity: () => import('@/modules/identity/locales'),
  overview: () => import('@/modules/overview/locales'),
}
export type LocaleDomain = keyof typeof loaders
const pending = new Map<LocaleDomain, Promise<void>>()

export function loadRouteMessages(domains: readonly LocaleDomain[]) {
  return Promise.all(
    domains.map((domain) => {
      let request = pending.get(domain)
      if (!request) {
        request = loaders[domain]()
          .then(({ messages }) => {
            i18n.global.mergeLocaleMessage('zh-CN', messages)
          })
          .catch((error: unknown) => {
            pending.delete(domain)
            throw error
          })
        pending.set(domain, request)
      }
      return request
    }),
  )
}
