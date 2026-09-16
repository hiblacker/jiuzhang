<script setup lang="ts">
import { reactive, useId } from 'vue'
import { NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { useFormSubmit } from '../../shared/forms'
defineProps<{ busy: boolean }>()
const emit = defineEmits<{ submit: [code: string] }>()
const id = useId()
const draft = reactive({ sourceCode: '' })
const rules = { sourceCode: { required: true, whitespace: true, message: '请填写来源编码' } }
const { form, validate } = useFormSubmit(() => emit('submit', draft.sourceCode.trim()))
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
      label="来源编码"
      path="sourceCode"
      :label-props="{ for: id }"
    >
      <NInput
        v-model:value="draft.sourceCode"
        :disabled="busy"
        :input-props="{ 'aria-label': '来源编码', id }"
      />
    </NFormItem>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
