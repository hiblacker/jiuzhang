<script setup lang="ts">
import { reactive, useId } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { columnNames, jsonObject, useFormSubmit } from '../../../shared/forms'
import type { PolicyInput } from '../types'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ submit: [value: PolicyInput] }>()
const id = useId()
const draft = reactive({ identity: '', columns: '', rowEquals: '{}' })
const required = { required: true, whitespace: true, message: '此项必填' }
const rules = { identity: required, columns: required }
const { form, validation, validate } = useFormSubmit(() => {
  const columns = columnNames(draft.columns)
  if (!columns.length) {
    throw new Error('请填写允许列')
  }
  emit('submit', {
    identity: draft.identity.trim(),
    columns,
    rowEquals: jsonObject(draft.rowEquals, '行范围'),
  })
})
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
    <NFormItem label="身份编码" path="identity" :label-props="{ for: `${id}-identity` }">
      <NInput
        v-model:value="draft.identity"
        :disabled="busy"
        :input-props="{ 'aria-label': '身份编码', id: `${id}-identity` }"
      />
    </NFormItem>
    <NFormItem label="允许列（逗号分隔）" path="columns" :label-props="{ for: `${id}-columns` }">
      <NInput
        v-model:value="draft.columns"
        :disabled="busy"
        :input-props="{ 'aria-label': '允许列（逗号分隔）', id: `${id}-columns` }"
      />
    </NFormItem>
    <NFormItem label="行范围（等值条件）" :label-props="{ for: `${id}-rows` }">
      <NInput
        v-model:value="draft.rowEquals"
        type="textarea"
        :autosize="{ minRows: 5, maxRows: 14 }"
        :disabled="busy"
        :input-props="{ 'aria-label': '行范围（等值条件）', id: `${id}-rows` }"
      />
    </NFormItem>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
