import { createRouter, createWebHistory } from 'vue-router';
import { usePermissionStore } from '@/stores/permission';
import { useSessionStore } from '@/stores/session';
import { routes } from './routes';

export const router = createRouter({
  // Real paths, so a link can be shared, a reload stays on the page and back/forward work.
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  // The first navigation waits for the session bootstrap: a hard refresh must not bounce a
  // signed-in user to the login page before the cookie has been checked.
  if (!session.ready) await session.bootstrap();
  if (to.meta.public) return true;
  if (!session.identity) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }
  const allowed = to.meta.roles;
  if (allowed && !allowed.includes(usePermissionStore().role ?? '')) return { name: 'overview' };
  return true;
});
