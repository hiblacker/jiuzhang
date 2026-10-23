<script setup lang="ts">
import { ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NCard, NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { Activity, Database, Layers, Warehouse } from 'lucide-vue-next'
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
      <div class="story-brand">
        <span class="story-mark">{{ t('ui.workspace_layout_27a2b9f1') }}</span
        ><span>JIUZHANG / DATA WORKSPACE</span>
      </div>
      <h1>{{ t('loginTitle') }}</h1>
      <p>{{ t('loginDescription') }}</p>
      <div class="login-flow">
        <div>
          <Database :size="18" /><span>{{ t('nav.sources') }}</span>
        </div>
        <span class="flow-arrow">→</span>
        <div>
          <Layers :size="18" /><span>{{ t('nav.datasets') }}</span>
        </div>
        <span class="flow-arrow">→</span>
        <div>
          <Warehouse :size="18" /><span>{{ t('nav.warehouse') }}</span>
        </div>
      </div>
      <div class="story-foot"><Activity :size="16" />{{ t('subtitle') }}</div>
    </div>
    <NCard class="login-card" :bordered="false">
      <template #header
        ><div class="login-card-heading">
          <strong>{{ t('workspace') }}</strong
          ><span>{{ t('login') }}</span>
        </div></template
      >
      <p class="login-hint">{{ t('identity.loginHint') }}</p>
      <NForm :model="credentials" label-placement="top" @submit.prevent="signIn">
        <NFormItem :label="t('identity.username')"
          ><NInput
            v-model:value="credentials.username"
            size="large"
            :input-props="{ 'aria-label': t('identity.username'), autocomplete: 'username' }"
        /></NFormItem>
        <NFormItem :label="t('identity.password')"
          ><NInput
            v-model:value="credentials.password"
            size="large"
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
          size="large"
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
  position: relative;
  overflow: hidden;
  min-height: 100vh;
  background:
    radial-gradient(circle at 12% 18%, var(--accentSoft), transparent 34%),
    radial-gradient(circle at 88% 78%, var(--accentTint), transparent 30%), var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 120px;
  padding: 32px;
}
.login-story {
  width: min(500px, 42vw);
}
.story-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--accent);
  font-weight: 700;
}
.story-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  background: var(--accent);
  color: var(--surfaceRaised);
  font-size: 21px;
  letter-spacing: 0;
}
h1 {
  font-size: 40px;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: -1.2px;
  margin: 32px 0 20px;
}
.login-story p {
  color: var(--textSecondary);
  line-height: 1.9;
}
.login-flow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 36px;
  font-size: 14px;
}
.login-flow div {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surfaceRaised) 72%, transparent);
}
.login-flow div svg,
.flow-arrow,
.story-foot svg {
  color: var(--accent);
}
.story-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 44px;
  color: var(--textTertiary);
  font-size: 12px;
}
.login-card {
  width: 420px;
  padding: 18px;
  box-shadow: 0 20px 60px color-mix(in srgb, var(--textPrimary) 12%, transparent);
}
.login-card-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  width: 100%;
}
.login-card-heading strong {
  font-size: 18px;
}
.login-card-heading span {
  color: var(--textSecondary);
  font-size: 12px;
}
.login-hint {
  margin: 0 0 28px;
  color: var(--textSecondary);
  font-size: 13px;
  line-height: 1.7;
}
@media (max-width: 1000px) {
  .login-page {
    gap: 40px;
  }
  .login-story {
    width: min(350px, 42vw);
  }
  h1 {
    font-size: 30px;
  }
}
</style>
