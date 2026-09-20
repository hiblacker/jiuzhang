import type { RouteRecordRaw } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /** Heading and menu label. */
    title?: string;
    /** Listed in the sidebar; the sidebar is derived from this table, never hand-written. */
    menu?: boolean;
    /** Reachable without a session (login/activation). */
    public?: boolean;
    /** Project roles allowed to open the page; the guard enforces it, so a hidden page is unreachable by URL too. */
    roles?: string[];
  }
}

/** Pages rendered inside the application shell. */
export const appRoutes: RouteRecordRaw[] = [
  {
    path: 'overview',
    name: 'overview',
    component: () => import('@/views/overview/OverviewView.vue'),
    meta: { title: '工作台', menu: true },
  },
  {
    path: 'systems',
    name: 'systems',
    component: () => import('@/views/ingestion/IngestionView.vue'),
    meta: { title: '接入管理', menu: true },
  },
  {
    path: 'assets',
    name: 'assets',
    component: () => import('@/views/assets/AssetsView.vue'),
    meta: { title: '资产目录', menu: true },
  },
  {
    path: 'models',
    name: 'models',
    component: () => import('@/views/models/ModelsView.vue'),
    meta: { title: '数据开发', menu: true, roles: ['OWNER', 'ENGINEER'] },
  },
  {
    path: 'datasets',
    name: 'datasets',
    component: () => import('@/views/datasets/DatasetsView.vue'),
    meta: { title: '服务数据集', menu: true },
  },
  {
    path: 'runs',
    name: 'runs',
    component: () => import('@/views/runs/RunsView.vue'),
    meta: { title: '运行中心', menu: true },
  },
  {
    path: 'settings',
    name: 'settings',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: { title: '项目与设置', menu: true },
  },
];

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('@/layouts/BlankLayout.vue'),
    children: [
      {
        path: '',
        name: 'login',
        component: () => import('@/views/session/LoginView.vue'),
        meta: { title: '登录', public: true },
      },
    ],
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    redirect: '/overview',
    children: [
      ...appRoutes,
      {
        path: ':pathMatch(.*)*',
        name: 'not-found',
        component: () => import('@/views/NotFoundView.vue'),
        meta: { title: '页面不存在' },
      },
    ],
  },
];
