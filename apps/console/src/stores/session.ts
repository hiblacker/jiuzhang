// Interim home for the session, the project selection and the role capabilities.
//
// Routing needs this state outside any component (navigation guards) and the layout needs it too,
// so P1 keeps it in one reactive module. P2 replaces it with the session/project/permission Pinia
// stores while keeping the exported names and call sites stable.
import { computed, reactive, watch } from 'vue';
import { api, ApiError, csrfToken, logout, type Identity, type Page, type Project } from '@/api';

export const session = reactive({
  identity: null as Identity | null,
  projects: [] as Project[],
  project: null as Project | null,
  projectSearch: '',
  projectPage: 1,
  projectTotal: 0,
  projectModal: false,
  error: '',
  ready: false,
  busy: false,
});

export const role = computed(() => session.project?.role ?? null);
export const isAdmin = computed(() => session.identity?.platformAdmin === true);
export const canManage = computed(() => role.value === 'OWNER');
export const canIngest = computed(() => role.value === 'OWNER' || role.value === 'ENGINEER');

let projectGeneration = 0;
let bootstrap: Promise<void> | null = null;

export async function loadProjects() {
  const current = ++projectGeneration;
  const result = await api<Page<Project>>(
    `/warehouse/catalog/projects?q=${encodeURIComponent(session.projectSearch)}&limit=25&offset=${(session.projectPage - 1) * 25}`,
  );
  if (current === projectGeneration) {
    session.projects = result.items;
    session.projectTotal = result.total;
    if (!session.project) session.project = result.items[0] || null;
  }
}

export async function identify() {
  session.identity = await api<Identity>('/warehouse/me');
  await loadProjects();
  if (session.project) {
    const current = session.identity.projects.find((item) => item.id === session.project?.id);
    if (current) session.project = current;
  }
}

export function selectProject(project: Project) {
  session.project = project;
  session.projectModal = false;
}

export function resetSession() {
  session.identity = null;
  session.project = null;
  session.projects = [];
  session.projectModal = false;
}

export async function signOut() {
  try {
    await logout();
  } finally {
    resetSession();
  }
}

/** Runs once per page load: the CSRF token plus the identity, tolerating an anonymous visitor. */
export function bootstrapSession() {
  bootstrap ??= (async () => {
    window.addEventListener('session-expired', resetSession);
    try {
      await csrfToken();
      await identify();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) session.error = (error as Error).message;
    } finally {
      session.ready = true;
    }
  })();
  return bootstrap;
}

watch(
  () => session.projectPage,
  () => {
    void loadProjects().catch((error: Error) => {
      session.error = error.message;
    });
  },
);
