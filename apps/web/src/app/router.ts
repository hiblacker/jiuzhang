import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { routeManifest } from './route-manifest'
import { supportsRealRoute } from './real-capabilities'
import { loadRouteMessages, type LocaleDomain } from './i18n'
import { readPreference } from '@/shared/lib/preferences'
import { sessionOptions } from '@/modules/identity'
import { queryClient } from './query-client'
import { ApiError } from '@/shared/api/client'
const sourcePages = {
  list: () => import('@/pages/sources/SourceListPage.vue'),
  editor: () => import('@/pages/sources/SourceEditorPage.vue'),
  detail: () => import('@/pages/sources/SourceDetailPage.vue'),
}
function component(path: string) {
  if (path === '/datasets') return () => import('@/pages/datasets/DatasetListPage.vue')
  if (path === '/datasets/new' || path === '/datasets/:id/edit')
    return () => import('@/pages/datasets/DatasetEditorPage.vue')
  if (path === '/datasets/:id') return () => import('@/pages/datasets/DatasetDetailPage.vue')
  if (path === '/datasets/:id/versions/:version')
    return () => import('@/pages/datasets/DatasetVersionPage.vue')
  if (path === '/tasks') return () => import('@/pages/jobs/TasksPage.vue')
  if (path === '/tasks/:id' || path === '/tasks/:id/edit')
    return () => import('@/pages/jobs/TaskPage.vue')
  if (path === '/runs') return () => import('@/pages/jobs/RunsPage.vue')
  if (path === '/runs/:id') return () => import('@/pages/jobs/RunDetailPage.vue')
  if (path === '/warehouse/overview')
    return () => import('@/pages/warehouse/WarehouseOverviewPage.vue')
  if (path === '/warehouse/tables') return () => import('@/pages/warehouse/TablesPage.vue')
  if (path === '/warehouse/tables/:id') return () => import('@/pages/warehouse/TableDetailPage.vue')
  if (path === '/warehouse/query') return () => import('@/pages/warehouse/QueryPage.vue')
  if (path === '/warehouse/imports') return () => import('@/pages/warehouse/ImportsPage.vue')
  if (path === '/warehouse/exports') return () => import('@/pages/warehouse/ExportsPage.vue')
  if (path === '/governance/catalog') return () => import('@/pages/governance/CatalogPage.vue')
  if (path === '/governance/lineage') return () => import('@/pages/governance/LineagePage.vue')
  if (path === '/governance/quality') return () => import('@/pages/governance/QualityPage.vue')
  if (path === '/governance/quality/:id') return () => import('@/pages/governance/QualityPage.vue')
  if (path === '/governance/masking') return () => import('@/pages/governance/MaskingPage.vue')
  if (path === '/governance/masking/:id') return () => import('@/pages/governance/MaskingPage.vue')
  if (path === '/services') return () => import('@/pages/services/ServicesPage.vue')
  if (path === '/services/new') return () => import('@/pages/services/ServiceEditorPage.vue')
  if (path === '/services/:id/edit') return () => import('@/pages/services/ServiceEditorPage.vue')
  if (path === '/services/:id') return () => import('@/pages/services/ServiceDetailPage.vue')
  if (path === '/system/users') return () => import('@/pages/system/UsersPage.vue')
  if (path === '/system/roles') return () => import('@/pages/system/RolesPage.vue')
  if (path === '/system/audit') return () => import('@/pages/system/AuditPage.vue')
  if (path === '/system/settings') return () => import('@/pages/system/SettingsPage.vue')
  if (path === '/overview') return () => import('@/pages/overview/OverviewPage.vue')
  if (path === '/sources') return sourcePages.list
  if (path === '/sources/new' || path === '/sources/:id/edit') return sourcePages.editor
  if (path === '/sources/:id') return sourcePages.detail
  if (path === '/403' || path === '/404') return () => import('@/pages/system/StatusPage.vue')
  throw new Error('Unmapped route: ' + path)
}
const children: RouteRecordRaw[] = routeManifest
  .filter((r) => r.id !== 'P36')
  .map((r) => ({
    path: r.path,
    component:
      import.meta.env.VITE_API_MODE === 'real' && !supportsRealRoute(r.path)
        ? () => import('@/pages/system/UnsupportedPage.vue')
        : component(r.path),
    meta: { ...r },
  }))
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('./layouts/WorkspaceLayout.vue'),
      children: [{ path: '', redirect: '/overview' }, ...children],
    },
    { path: '/login', component: () => import('@/pages/auth/LoginPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/404' },
  ],
})
router.beforeEach(async (to) => {
  if (
    import.meta.env.VITE_API_MODE === 'mock' &&
    to.path !== '/login' &&
    readPreference('session', '') !== 'demo'
  )
    return { path: '/login', query: { redirect: to.fullPath } }
  if (['/login', '/403', '/404'].includes(to.path)) return true
  const role = readPreference('role', 'developer')
  let permissions: string[]
  try {
    permissions = (await queryClient.fetchQuery(sessionOptions(role, readPreference('user', ''))))
      .permissions
  } catch (error) {
    if (
      import.meta.env.VITE_API_MODE === 'real' &&
      error instanceof ApiError &&
      error.status === 401
    )
      return { path: '/login', query: { redirect: to.fullPath } }
    if (error instanceof ApiError && [401, 403].includes(error.status))
      return { path: '/403', query: { redirect: to.fullPath } }
    return { path: '/403', query: { reason: 'unavailable', redirect: to.fullPath } }
  }
  if (!permissions.includes('read')) return { path: '/403', query: { redirect: to.fullPath } }
  if (
    !permissions.includes('system') &&
    ['/system/users', '/system/roles', '/system/audit'].some((path) => to.path.startsWith(path))
  )
    return { path: '/403', query: { redirect: to.fullPath } }
  if (!permissions.includes('write') && (to.path.endsWith('/new') || to.path.endsWith('/edit')))
    return { path: '/403', query: { redirect: to.fullPath } }
  return true
})

const routeLocales: Record<string, readonly LocaleDomain[]> = {
  overview: ['overview'],
  sources: ['sources', 'datasets', 'jobs'],
  datasets: ['datasets', 'sources', 'governance', 'jobs', 'warehouse'],
  tasks: ['jobs', 'sources'],
  warehouse: ['warehouse', 'sources', 'overview'],
  governance: ['governance', 'datasets', 'sources', 'jobs', 'overview'],
  services: ['services', 'sources', 'warehouse', 'identity'],
  system: ['identity', 'sources', 'warehouse'],
  login: ['identity'],
}
router.beforeResolve(async (to) => {
  const section = to.path === '/login' ? 'login' : String(to.meta.section ?? '')
  await loadRouteMessages(routeLocales[section] ?? [])
})
