import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { ApiError, api, csrfToken, logout, type Identity } from '@/api';
import { useProjectStore } from '@/stores/project';

/**
 * Who is signed in. The project selection lives in its own store and the capabilities derived
 * from it live in the permission store, so a page never has to know how a role maps to a button.
 */
export const useSessionStore = defineStore('session', () => {
  const identity = ref<Identity | null>(null);
  const ready = ref(false);
  const error = ref('');
  const busy = ref(false);
  const isAdmin = computed(() => identity.value?.platformAdmin === true);
  let bootstrap: Promise<void> | null = null;

  async function identify() {
    const project = useProjectStore();
    identity.value = await api<Identity>('/warehouse/me');
    await project.load();
    project.syncRole(identity.value.projects);
  }

  function reset() {
    identity.value = null;
    useProjectStore().reset();
  }

  /** Runs once per page load: the CSRF token plus the identity, tolerating an anonymous visitor. */
  function bootstrapSession() {
    bootstrap ??= (async () => {
      window.addEventListener('session-expired', reset);
      try {
        await csrfToken();
        await identify();
      } catch (failure) {
        if (!(failure instanceof ApiError && failure.status === 401)) error.value = (failure as Error).message;
      } finally {
        ready.value = true;
      }
    })();
    return bootstrap;
  }

  async function signOut() {
    try {
      await logout();
    } finally {
      reset();
    }
  }

  return { identity, ready, error, busy, isAdmin, identify, reset, bootstrap: bootstrapSession, signOut };
});
