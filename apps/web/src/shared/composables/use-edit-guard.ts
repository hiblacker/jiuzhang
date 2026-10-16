import { toValue, onMounted, onBeforeUnmount, type MaybeRefOrGetter } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useI18n } from 'vue-i18n'
/** One discard decision for drawer close, route departure and browser unload. */
export function useEditGuard(dirty: MaybeRefOrGetter<boolean>, pending: MaybeRefOrGetter<boolean>) {
  const { t } = useI18n()
  const canLeave = () => !toValue(pending) && (!toValue(dirty) || window.confirm(t('unsaved')))
  function beforeUnload(event: BeforeUnloadEvent) {
    if (toValue(dirty) || toValue(pending)) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  onBeforeRouteLeave(canLeave)
  onBeforeRouteUpdate((to, from) => to.path === from.path || canLeave())
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
  return { canLeave }
}
