import { watch, type Ref } from 'vue';
import { notify } from '@/composables/notify';

/**
 * Reports a component's message state as a toast and clears it, so feedback is visible without
 * living inside the page layout.
 */
export function useToast(source: Ref<string>, level: 'error' | 'success' | 'warning' | 'info' = 'error') {
  watch(source, (message) => {
    if (!message) return;
    notify[level](message);
    source.value = '';
  });
}

export function useErrorToast(source: Ref<string>) {
  useToast(source, 'error');
}
