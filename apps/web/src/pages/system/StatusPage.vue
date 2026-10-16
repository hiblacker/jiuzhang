<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NResult, NButton } from 'naive-ui'
import { computed } from 'vue'
const route = useRoute(),
  router = useRouter(),
  { t } = useI18n()
const result = computed(() => {
  if (route.query.reason === 'unavailable')
    return { status: 'error' as const, title: t('errors.NETWORK_ERROR') }
  if (route.path === '/403') return { status: '403' as const, title: t('forbidden') }
  return { status: '404' as const, title: t('notFound') }
})
const description = computed(() => {
  if (route.query.reason === 'unavailable') return undefined
  return route.path === '/403' ? t('forbiddenHint') : t('notFoundHint')
})
function back() {
  const previous: unknown = router.options.history.state.back
  const previousRoute =
    typeof previous === 'string' &&
    previous.startsWith('/') &&
    !previous.startsWith('//') &&
    !['/403', '/404'].some((path) => previous.startsWith(path))
  const referrer = document.referrer ? new URL(document.referrer) : null
  const previousDocument =
    referrer?.origin === window.location.origin &&
    !['/403', '/404'].some((path) => referrer.pathname.startsWith(path))
  if (window.history.length > 1 && (previousRoute || previousDocument)) router.back()
  else void router.push('/overview')
}
function switchRole() {
  const target = route.query.redirect
  const redirect =
    typeof target === 'string' &&
    target.startsWith('/') &&
    !target.startsWith('//') &&
    !['/login', '/403', '/404'].some((path) => target.startsWith(path))
      ? target
      : '/overview'
  void router.push({ path: '/login', query: { redirect } })
}
function retry() {
  const target = String(route.query.redirect ?? '/overview')
  void router.push(target.startsWith('/') && !target.startsWith('//') ? target : '/overview')
}
</script>
<template>
  <NResult
    :status="result.status"
    :title="result.title"
    :description="description"
    class="status-page"
    ><template #footer
      ><div class="status-actions">
        <NButton @click="back">{{ t('previousPage') }}</NButton
        ><NButton v-if="route.path === '/403'" @click="switchRole">{{ t('switchRole') }}</NButton
        ><NButton v-if="route.query.reason === 'unavailable'" @click="retry">{{
          t('retry')
        }}</NButton
        ><NButton type="primary" @click="router.push('/overview')">{{ t('home') }}</NButton>
      </div></template
    ></NResult
  >
</template>
<style scoped>
.status-page {
  padding: 100px 0;
}
.status-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}
</style>
