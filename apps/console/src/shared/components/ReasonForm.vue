<script setup lang="ts">
import { reactive, useId } from 'vue'
import { NButton, NForm, NFormItem, NInput } from 'naive-ui'
import { useFormSubmit } from '../forms'

const props = defineProps<{ label: string, busy: boolean }>()
const emit = defineEmits<{ submit: [reason: string] }>()
const id = useId()
const draft = reactive({ reason: '' })
const rules = { reason: { required: true, whitespace: true, message: `请填写${props.label}` } }
const { form, validate } = useFormSubmit(() => emit('submit', draft.reason.trim()))
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
      :label="label"
      path="reason"
      :label-props="{ for: id }"
    >
      <NInput
        v-model:value="draft.reason"
        type="textarea"
        :disabled="busy"
        :input-props="{ id }"
      />
    </NFormItem>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
