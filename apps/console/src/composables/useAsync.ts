import { ref } from 'vue';

/**
 * One shape for the "press a button, show a spinner, report the failure" flows, so no page has to
 * repeat the try/catch/finally dance.
 */
export function useAsync() {
  const busy = ref(false);
  const error = ref('');

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    busy.value = true;
    error.value = '';
    try {
      return await action();
    } catch (failure) {
      error.value = (failure as Error).message;
      return undefined;
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, run };
}
