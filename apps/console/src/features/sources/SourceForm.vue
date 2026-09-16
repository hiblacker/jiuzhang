<script setup lang="ts">
import { reactive, useId } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NSelect } from 'naive-ui'
import { jsonObject, useFormSubmit } from '../../shared/forms'
import type { SourceInput } from './api'
defineProps<{ busy: boolean }>()
const emit = defineEmits<{ submit: [input: SourceInput] }>()
const id = useId()
const draft = reactive({ code: '', sourceType: 'MYSQL', credentialRef: '', config: '{}' })
const required = { required: true, whitespace: true, message: '此项必填' }
const rules = { code: required, sourceType: required, credentialRef: required }
const options = ['MYSQL', 'FILE', 'REST'].map(value => ({ label: value, value }))
const { form, validation, validate } = useFormSubmit(() =>
  emit('submit', {
    code: draft.code.trim(),
    sourceType: draft.sourceType,
    credentialRef: draft.credentialRef.trim(),
    config: jsonObject(draft.config, '来源配置'),
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
      <NFormItem label="来源编码" path="code" :label-props="{ for: `${id}-code` }">
        <NInput v-model:value="draft.code" :disabled="busy" :input-props="{ 'aria-label': '来源编码', id: `${id}-code` }" />
      </NFormItem>
      <NFormItem label="来源类型" path="sourceType" :label-props="{ for: `${id}-type` }">
        <NSelect
          v-model:value="draft.sourceType"
          filterable
          :options="options"
          :disabled="busy"
          :input-props="{ id: `${id}-type`, 'aria-label': '来源类型' }"
        />
      </NFormItem>
      <NFormItem label="凭证引用" path="credentialRef" :label-props="{ for: `${id}-credential` }">
        <NInput
          v-model:value="draft.credentialRef"
          :disabled="busy"
          :input-props="{ 'aria-label': '凭证引用', id: `${id}-credential` }"
        />
      </NFormItem>
      <NFormItem label="来源配置" class="full-width" :label-props="{ for: `${id}-config` }">
        <NInput
          v-model:value="draft.config"
          type="textarea"
          :autosize="{ minRows: 5, maxRows: 14 }"
          :disabled="busy"
          :input-props="{ 'aria-label': '来源配置', id: `${id}-config` }"
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
