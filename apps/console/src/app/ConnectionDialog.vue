<script setup lang="ts">
import { onScopeDispose, ref } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NSelect } from 'naive-ui'
import { useConsoleContext } from './context'
import { errorText } from '../shared/errors'
import type { AccessMode } from '../stores/session'

const emit = defineEmits<{ connected: [mode: AccessMode] }>()
const context = useConsoleContext()
const base = ref(import.meta.env.VITE_API_BASE_URL || window.location.origin)
const token = ref('')
const mode = ref<AccessMode>('admin')
const error = ref('')
const connecting = ref(false)
onScopeDispose(() => {
  token.value = ''
})
async function connect() {
  if (connecting.value) {
    return
  }
  connecting.value = true
  error.value = ''
  try {
    await context.connect(base.value, token.value, mode.value)
    token.value = ''
    emit('connected', mode.value)
  }
  catch (cause) {
    error.value = errorText(cause)
    token.value = ''
  }
  finally {
    connecting.value = false
  }
}
const modes = [
  { label: '平台管理', value: 'admin' },
  { label: '项目成员', value: 'project' },
]
</script>

<template>
  <NModal
    :show="true"
    preset="card"
    title="连接工作台"
    class="connection-modal"
    :mask-closable="false"
    :closable="false"
    :close-on-esc="false"
  >
    <NAlert v-if="error" type="error" class="section-gap">
      {{ error }}
    </NAlert>
    <NForm label-placement="top" @submit.prevent="connect">
      <NFormItem label="控制 API 地址" :label-props="{ for: 'base-url' }">
        <NInput
          v-model:value="base"
          :disabled="connecting"
          :input-props="{ 'aria-label': '控制 API 地址', id: 'base-url', autocomplete: 'url' }"
        />
      </NFormItem>
      <NFormItem label="访问令牌" :label-props="{ for: 'token' }">
        <NInput
          v-model:value="token"
          type="password"
          show-password-on="click"
          :disabled="connecting"
          :input-props="{ 'aria-label': '访问令牌', id: 'token', autocomplete: 'off' }"
        />
      </NFormItem>
      <NFormItem label="访问视图" :label-props="{ for: 'access-mode' }">
        <NSelect
          v-model:value="mode"
          filterable
          :options="modes"
          :input-props="{ id: 'access-mode', 'aria-label': '访问视图' }"
          :disabled="connecting"
        />
      </NFormItem>
      <NButton
        type="primary"
        attr-type="submit"
        block
        :loading="connecting"
      >
        连接
      </NButton>
    </NForm>
  </NModal>
</template>
