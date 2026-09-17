import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { api, type Page, type Project } from '@/api';

/**
 * The project list, the current project and the picker state. Pages react to `selected`, so
 * switching projects refreshes them without a reload.
 */
export const useProjectStore = defineStore('project', () => {
  const items = ref<Project[]>([]);
  const selected = ref<Project | null>(null);
  const search = ref('');
  const page = ref(1);
  const total = ref(0);
  const modal = ref(false);
  const error = ref('');
  let generation = 0;

  async function load() {
    const current = ++generation;
    const result = await api<Page<Project>>(
      `/warehouse/catalog/projects?q=${encodeURIComponent(search.value)}&limit=25&offset=${(page.value - 1) * 25}`,
    );
    if (current !== generation) return;
    items.value = result.items;
    total.value = result.total;
    if (!selected.value) selected.value = result.items[0] || null;
  }

  /** Keeps the selected project's role in step with the identity response. */
  function syncRole(projects: Project[]) {
    const current = projects.find((item) => item.id === selected.value?.id);
    if (current) selected.value = current;
  }

  function select(project: Project) {
    selected.value = project;
    modal.value = false;
  }

  function openPicker() {
    modal.value = true;
    page.value = 1;
    void load().catch((failure: Error) => {
      error.value = failure.message;
    });
  }

  function reset() {
    items.value = [];
    selected.value = null;
    modal.value = false;
    error.value = '';
  }

  watch(page, () => {
    void load().catch((failure: Error) => {
      error.value = failure.message;
    });
  });

  return { items, selected, search, page, total, modal, error, load, syncRole, select, openPicker, reset };
});
