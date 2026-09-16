<script setup lang="ts">
import { reactive, useId } from 'vue'
import { NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { useFormSubmit } from '../../shared/forms'
import type { ProjectInput } from './api'
defineProps<{ busy: boolean }>()
const emit = defineEmits<{ submit: [input: ProjectInput] }>()
const id = useId()
const draft = reactive({ code: '', name: '', description: '' })
const required = { required: true, whitespace: true, message: '此项必填' }
const rules = { code: required, name: required }
const { form, validate } = useFormSubmit(() =>
  emit('submit', {
    code: draft.code.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
  }),
)
</script>
<template>
  <NForm
    ref="form"
    :model="draft"
    :rules="rules"
    label-placement="top"
    @submit.prevent="validate"
  >
    <NFormItem
      label="项目编码"
      path="code"
      :label-props="{ for: `${id}-code` }"
    >
      <NInput
        v-model:value="draft.code"
        :disabled="busy"
        :input-props="{ 'aria-label': '项目编码', id: `${id}-code` }"
      />
    </NFormItem>
    <NFormItem
      label="项目名称"
      path="name"
      :label-props="{ for: `${id}-name` }"
    >
      <NInput
        v-model:value="draft.name"
        :disabled="busy"
        :input-props="{ 'aria-label': '项目名称', id: `${id}-name` }"
      />
    </NFormItem>
    <NFormItem
      label="项目说明"
      :label-props="{ for: `${id}-description` }"
    >
      <NInput
        v-model:value="draft.description"
        type="textarea"
        :disabled="busy"
        :input-props="{ 'aria-label': '项目说明', id: `${id}-description` }"
      />
    </NFormItem>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
