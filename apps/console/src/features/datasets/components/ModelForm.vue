<script setup lang="ts">
import { reactive, useId } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NInputNumber } from 'naive-ui'
import { jsonObject, useFormSubmit } from '../../../shared/forms'
import type { ModelInput } from '../types'

const props = defineProps<{ initial: ModelInput, editing: boolean, busy: boolean }>()
const emit = defineEmits<{ submit: [value: ModelInput] }>()
const id = useId()
const draft = reactive({
  ...props.initial,
  contract: JSON.stringify(props.initial.contract, null, 2),
})
const required = { required: true, whitespace: true, message: '此项必填', trigger: 'blur' }
const rules = {
  code: required,
  name: required,
  runtimeRef: required,
  gitRevision: [required, { pattern: /^[0-9a-f]{40}$/, message: 'Git 提交必须为 40 位十六进制值' }],
  bundleSha256: [
    required,
    { pattern: /^[0-9a-f]{64}$/, message: '模型包摘要必须为 64 位十六进制值' },
  ],
}
const { form, validation, validate } = useFormSubmit(() =>
  emit('submit', {
    code: draft.code.trim(),
    name: draft.name.trim(),
    runtimeRef: draft.runtimeRef.trim(),
    expectedVersion: draft.expectedVersion,
    gitRevision: draft.gitRevision.trim(),
    bundleSha256: draft.bundleSha256.trim(),
    contract: jsonObject(draft.contract, '数据契约'),
  }),
)
</script>

<template>
  <NAlert v-if="validation" type="error" class="section-gap">
    {{ validation }}
  </NAlert>
  <NForm
    ref="form"
    :model="draft"
    :rules="rules"
    label-placement="top"
    @submit.prevent="validate"
  >
    <div class="form-grid">
      <NFormItem label="数据集编码" path="code" :label-props="{ for: `${id}-code` }">
        <NInput
          v-model:value="draft.code"
          :disabled="busy || editing"
          :input-props="{ 'aria-label': '数据集编码', id: `${id}-code` }"
        />
      </NFormItem>
      <NFormItem label="数据集名称" path="name" :label-props="{ for: `${id}-name` }">
        <NInput v-model:value="draft.name" :disabled="busy" :input-props="{ 'aria-label': '数据集名称', id: `${id}-name` }" />
      </NFormItem>
      <NFormItem label="执行配置名" path="runtimeRef" :label-props="{ for: `${id}-runtime` }">
        <NInput
          v-model:value="draft.runtimeRef"
          :disabled="busy"
          :input-props="{ 'aria-label': '执行配置名', id: `${id}-runtime` }"
        />
      </NFormItem>
      <NFormItem label="当前模型版本" :label-props="{ for: `${id}-version` }">
        <NInputNumber
          :value="draft.expectedVersion"
          disabled
          :input-props="{ 'aria-label': '当前模型版本', id: `${id}-version` }"
        />
      </NFormItem>
      <NFormItem label="Git 提交（40 位）" path="gitRevision" :label-props="{ for: `${id}-git` }">
        <NInput
          v-model:value="draft.gitRevision"
          :disabled="busy"
          :input-props="{ 'aria-label': 'Git 提交（40 位）', id: `${id}-git` }"
        />
      </NFormItem>
      <NFormItem label="模型包 SHA-256" path="bundleSha256" :label-props="{ for: `${id}-sha` }">
        <NInput
          v-model:value="draft.bundleSha256"
          :disabled="busy"
          :input-props="{ 'aria-label': '模型包 SHA-256', id: `${id}-sha` }"
        />
      </NFormItem>
      <NFormItem label="数据契约" class="full-width" :label-props="{ for: `${id}-contract` }">
        <NInput
          v-model:value="draft.contract"
          type="textarea"
          :autosize="{ minRows: 5, maxRows: 14 }"
          :disabled="busy"
          :input-props="{ 'aria-label': '数据契约', id: `${id}-contract` }"
        />
      </NFormItem>
    </div>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
