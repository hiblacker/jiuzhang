import { onScopeDispose, ref, watch } from 'vue'
import { useConsoleContext } from '../../app/context.ts'
import type { ConsoleContext } from '../../app/context.ts'
import { errorText } from '../errors.ts'

export function useApi(context: ConsoleContext = useConsoleContext()) {
  const controller = new AbortController()
  const loading = ref(false)
  const error = ref('')
  const invalidate = () => controller.abort()
  watch(() => context.session.generation, invalidate, { flush: 'sync' })
  watch(() => context.projects.generation, invalidate, { flush: 'sync' })
  onScopeDispose(invalidate)

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (loading.value || controller.signal.aborted) {
      return
    }
    loading.value = true
    error.value = ''
    try {
      return await action()
    }
    catch (cause) {
      if (
        !controller.signal.aborted
        && !(cause instanceof DOMException && cause.name === 'AbortError')
      ) {
        error.value = errorText(cause)
      }
    }
    finally {
      loading.value = false
    }
  }

  const call = <T>(route: string, body?: unknown, csv = false) =>
    context.request<T>(route, body, controller.signal, csv)
  return { loading, error, run, call }
}
