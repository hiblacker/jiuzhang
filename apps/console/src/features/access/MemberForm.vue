<script setup lang="ts">
import { reactive, useId } from 'vue'
import { NButton, NForm, NFormItem, NInput, NSelect } from 'naive-ui'
import { useFormSubmit } from '../../shared/forms'
import type { Member, MemberInput } from './api'
const props = defineProps<{ member: Member | null, busy: boolean }>()
const emit = defineEmits<{ submit: [input: MemberInput] }>()
const id = useId()
const draft = reactive<MemberInput>({
  identity: props.member?.identity_id ?? '',
  role: props.member?.role ?? 'VIEWER',
})
const required = { required: true, whitespace: true, message: '此项必填' }
const rules = { identity: required, role: required }
const options = [
  { label: '查看者', value: 'VIEWER' },
  { label: '数据开发', value: 'ENGINEER' },
  { label: '项目管理员', value: 'OWNER' },
]
const { form, validate } = useFormSubmit(() =>
  emit('submit', { identity: draft.identity.trim(), role: draft.role }),
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
      label="身份编码"
      path="identity"
      :label-props="{ for: `${id}-identity` }"
    >
      <NInput
        v-model:value="draft.identity"
        :disabled="busy || !!member"
        :input-props="{ 'aria-label': '身份编码', id: `${id}-identity` }"
      />
    </NFormItem>
    <NFormItem
      label="角色"
      path="role"
      :label-props="{ for: `${id}-role` }"
    >
      <NSelect
        v-model:value="draft.role"
        filterable
        :options="options"
        :disabled="busy"
        :input-props="{ id: `${id}-role`, 'aria-label': '角色' }"
      />
    </NFormItem>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
