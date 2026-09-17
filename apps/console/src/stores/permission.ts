import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useProjectStore } from '@/stores/project';

/** Capabilities derived from the role of the current project: one source for menus and buttons. */
export const usePermissionStore = defineStore('permission', () => {
  const project = useProjectStore();
  const role = computed(() => project.selected?.role ?? null);
  const canManage = computed(() => role.value === 'OWNER');
  const canIngest = computed(() => role.value === 'OWNER' || role.value === 'ENGINEER');
  const canOperate = computed(() => canManage.value || canIngest.value);
  return { role, canManage, canIngest, canOperate };
});
