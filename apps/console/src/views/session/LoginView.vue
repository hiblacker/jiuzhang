<script setup lang="ts">
import { ref } from 'vue';
import { NAlert, NButton, NCard, NFormItem, NInput } from 'naive-ui';
import { useRoute, useRouter } from 'vue-router';
import { api, login } from '@/api';
import { identify, session } from '@/stores/session';

const route = useRoute();
const router = useRouter();
const username = ref('');
const password = ref('');
const invitation = ref('');
const activate = ref(false);
const busy = ref(false);
const error = ref('');
const status = ref('');

const INVITATION_LENGTH = 43;
const MIN_PASSWORD_CHARS = 12;
const MAX_PASSWORD_BYTES = 72;

// Mirrors the control API pre-checks so a malformed paste or short password is
// named before any request is sent; the server keeps the authoritative check.
function activationProblem(code: string, secret: string) {
  const trimmed = code.trim();
  if (trimmed.length !== INVITATION_LENGTH)
    return `邀请码应为 ${INVITATION_LENGTH} 位，当前 ${trimmed.length} 位。请只复制邀请文件里 invitation 的值，不要带引号、花括号或换行。`;
  if (!secret) return '请输入要设置的密码。';
  if (secret.length < MIN_PASSWORD_CHARS) return `密码至少 ${MIN_PASSWORD_CHARS} 个字符，当前 ${secret.length} 个。`;
  const bytes = new TextEncoder().encode(secret).length;
  return bytes > MAX_PASSWORD_BYTES
    ? `密码不能超过 ${MAX_PASSWORD_BYTES} 字节，当前 ${bytes} 字节（一个汉字按 3 字节计）。`
    : '';
}

async function submit() {
  const problem = activate.value ? activationProblem(invitation.value, password.value) : '';
  if (problem) {
    error.value = problem;
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    if (activate.value) {
      await api('/auth/activate', { invitation: invitation.value.trim(), password: password.value });
      invitation.value = '';
      activate.value = false;
      status.value = '密码已设置，请用新密码登录。';
    } else {
      session.project = null;
      session.projectPage = 1;
      session.projectSearch = '';
      await login(username.value, password.value);
      await identify();
      const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/overview';
      await router.push(redirect);
    }
  } catch (failure) {
    error.value = (failure as Error).message;
  } finally {
    password.value = '';
    busy.value = false;
  }
}
</script>

<template>
  <n-card class="login-card" title="九章数据平台">
    <p class="muted">统一接入 · 持续交付 · 可信数据</p>
    <n-alert v-if="error" type="error" class="gap">{{ error }}</n-alert>
    <n-alert v-else-if="status" type="success" class="gap">{{ status }}</n-alert>
    <form @submit.prevent="submit">
      <n-form-item v-if="!activate" label="账号">
        <n-input v-model:value="username" :input-props="{ 'aria-label': '账号' }" autocomplete="username" />
      </n-form-item>
      <n-form-item v-else label="开户或重置邀请码">
        <n-input
          v-model:value="invitation"
          :input-props="{ 'aria-label': '邀请码' }"
          type="password"
          autocomplete="off"
        />
      </n-form-item>
      <n-form-item :label="activate ? '设置密码（至少 12 字符）' : '密码'">
        <n-input
          v-model:value="password"
          :input-props="{ 'aria-label': '密码' }"
          type="password"
          :autocomplete="activate ? 'new-password' : 'current-password'"
          show-password-on="click"
        />
      </n-form-item>
      <n-button attr-type="submit" type="primary" block :loading="busy" :disabled="!session.ready">
        {{ activate ? '设置密码' : '登录' }}
      </n-button>
      <n-button
        text
        class="gap"
        @click="
          activate = !activate;
          error = '';
          status = '';
        "
        >{{ activate ? '返回登录' : '使用邀请码开户 / 重置密码' }}</n-button
      >
    </form>
  </n-card>
</template>
