<script setup lang="ts">
import { reactive, useId } from 'vue'
import { NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { useFormSubmit } from '../../shared/forms'
defineProps<{ busy: boolean }>()
const emit = defineEmits<{ submit: [identity: string] }>()
const id = useId()
const draft = reactive({ identity: '' })
const rules = { identity: { required: true, whitespace: true, message: '请填写身份编码' } }
const { form, validate } = useFormSubmit(() => emit('submit', draft.identity.trim()))
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
      label="身份编码"
      path="identity"
      :label-props="{ for: id }"
    >
      <NInput
        v-model:value="draft.identity"
        :disabled="busy"
        :input-props="{ 'aria-label': '身份编码', id }"
      />
    </NFormItem>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
