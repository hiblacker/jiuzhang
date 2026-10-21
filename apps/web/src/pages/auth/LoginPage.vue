<script setup lang="ts">
import { ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NCard, NButton, NAlert, NForm, NFormItem, NInput } from 'naive-ui'
import { useAuthentication } from '@/modules/identity'
const { t } = useI18n(),
  route = useRoute(),
  router = useRouter()
const authentication = useAuthentication()
const credentials = ref({ username: '', password: '' })
const cache = useQueryClient()
async function signIn() {
  if (authentication.login.isPending.value) return
  try {
    await authentication.login.mutateAsync(credentials.value)
    credentials.value.password = ''
    await cache.cancelQueries()
    cache.clear()
    const next = String(route.query.redirect ?? '/overview')
    await router.push(next.startsWith('/') && !next.startsWith('//') ? next : '/overview')
  } catch {}
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
    <NCard :title="t('workspace')" class="login-card" :bordered="false">
      <NAlert type="info" class="mb">{{ t('identity.realHint') }}</NAlert>
      <NForm :model="credentials" label-placement="top" @submit.prevent="signIn">
        <NFormItem :label="t('identity.username')"
          ><NInput
            v-model:value="credentials.username"
            :input-props="{ 'aria-label': t('identity.username'), autocomplete: 'username' }"
        /></NFormItem>
        <NFormItem :label="t('identity.password')"
          ><NInput
            v-model:value="credentials.password"
            type="password"
            show-password-on="click"
            :input-props="{
              'aria-label': t('identity.password'),
              autocomplete: 'current-password',
            }"
        /></NFormItem>
        <NButton
          attr-type="submit"
          type="primary"
          block
          :loading="authentication.login.isPending.value"
          >{{ t('identity.signIn') }}</NButton
        >
      </NForm>
    </NCard>
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
