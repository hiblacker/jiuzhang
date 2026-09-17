import { ref, watch, type Ref } from 'vue';
import { api, type Page } from '@/api';

/**
 * The list pattern every page repeats: a search box, a page number, a total and the
 * stale-response guard. Callers only describe how to build their request path.
 */
export function usePagedQuery<T>(options: {
  /** Builds the request path for the current page and search text. */
  route: (context: { page: number; query: string; limit: number }) => string;
  /** Reactive key that resets the list when it changes, for example the selected project. */
  resetKey?: () => unknown;
  limit?: number;
}) {
  const limit = options.limit ?? 25;
  const rows = ref([]) as Ref<T[]>;
  const query = ref('');
  const page = ref(1);
  const total = ref(0);
  const loading = ref(false);
  const listError = ref('');
  let generation = 0;

  async function load() {
    const current = ++generation;
    loading.value = true;
    listError.value = '';
    try {
      const result = await api<Page<T>>(options.route({ page: page.value, query: query.value, limit }));
      if (current !== generation) return;
      rows.value = result.items;
      total.value = result.total;
    } catch (failure) {
      if (current === generation) listError.value = (failure as Error).message;
    } finally {
      if (current === generation) loading.value = false;
    }
  }

  /** Searching always restarts at the first page; both happen in one action. */
  function search() {
    if (page.value === 1) void load();
    else page.value = 1;
  }

  watch(page, () => void load());
  if (options.resetKey) {
    watch(
      options.resetKey,
      () => {
        page.value = 1;
        void load();
      },
      { immediate: true },
    );
  } else {
    void load();
  }

  return { rows, query, page, total, loading, listError, load, search };
}
