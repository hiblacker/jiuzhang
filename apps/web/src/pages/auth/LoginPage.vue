<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NCard, NButton, NSelect, NAlert } from 'naive-ui'
import { useUiStore, useDemoUsers } from '@/modules/identity'
const { t } = useI18n(),
  route = useRoute(),
  router = useRouter(),
  ui = useUiStore()
const role = ref(ui.role)
const users = useDemoUsers(),
  cache = useQueryClient(),
  userId = ref(ui.userId)
const options = computed(
  () =>
    users.data.value
      ?.filter((user) => user.role === role.value)
      .map((user) => ({
        label: user.name + (user.enabled ? '' : ' · ' + t('identity.disabled')),
        value: user.id,
        disabled: !user.enabled,
      })) ?? [],
)
watch(
  options,
  (value) => {
    if (!value.some((user) => user.value === userId.value && !user.disabled))
      userId.value = value.find((user) => !user.disabled)?.value ?? ''
  },
  { immediate: true },
)
async function login() {
  if (!userId.value) return
  ui.setRole(role.value)
  ui.setUser(userId.value)
  await cache.cancelQueries()
  cache.clear()
  ui.login()
  const next = String(route.query.redirect ?? '/overview')
  await router.push(next.startsWith('/') && !next.startsWith('//') ? next : '/overview')
}
</script>
<template>
  <main class="login-page">
    <div class="login-story">
      <div class="eyebrow">JIUZHANG / DATA WORKSPACE</div>
      <h1>{{ t('loginTitle') }}</h1>
      <p>{{ t('loginDescription') }}</p>
      <div class="login-flow">
        {{ t('nav.sources') }} <span>→</span> {{ t('nav.datasets') }} <span>→</span>
        {{ t('nav.warehouse') }}
      </div>
    </div>
    <NCard :title="t('workspace')" class="login-card" :bordered="false"
      ><NAlert type="info" class="mb">{{ t('demoNote') }}</NAlert
      ><label class="role-label">{{ t('role') }}</label
      ><NSelect
        v-model:value="role"
        :aria-label="t('role')"
        :options="['developer', 'admin', 'viewer'].map((value) => ({ value, label: t(value) }))"
      /><label class="role-label">{{ t('identity.user') }}</label
      ><NSelect
        v-model:value="userId"
        :options="options"
        :aria-label="t('identity.user')"
        :loading="users.isLoading.value"
      /><NAlert v-if="users.error.value" type="error">{{ t('errors.NETWORK_ERROR') }}</NAlert
      ><NButton
        type="primary"
        :disabled="!userId || users.isLoading.value"
        block
        size="large"
        class="login-button"
        @click="login"
        >{{ t('login') }}</NButton
      ></NCard
    >
  </main>
</template>
<style scoped>
.login-page {
  min-height: 100vh;
  background: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 100px;
  padding: 32px;
}
.login-story {
  max-width: 500px;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--accent);
}
h1 {
  font-size: 40px;
  font-weight: 650;
  line-height: 1.5;
}
.login-story p {
  color: var(--textSecondary);
  line-height: 1.9;
}
.login-flow {
  display: flex;
  gap: 20px;
  margin-top: 40px;
  font-size: 14px;
}
.login-flow span {
  color: var(--accent);
}
.login-card {
  width: 380px;
  padding: 15px;
}
.login-button {
  margin-top: 24px;
}
.role-label {
  display: block;
  margin: 24px 0 10px;
}
@media (max-width: 1000px) {
  .login-page {
    gap: 40px;
  }
  .login-story {
    max-width: 350px;
  }
  h1 {
    font-size: 30px;
  }
}
</style>
