<script setup lang="ts">
import { computed, reactive, useId } from 'vue'
import { NButton, NCheckbox, NForm, NFormItem, NInput, NSelect } from 'naive-ui'
import { useFormSubmit } from '../../shared/forms'
import { today } from '../../shared/types'
import type { Plan } from '../../shared/types'
import type { TriggerInput } from './api'
const props = defineProps<{ plans: Plan[], selected: number | null, busy: boolean }>()
const emit = defineEmits<{ submit: [input: TriggerInput] }>()
const id = useId()
const draft = reactive({ plan: props.selected, day: today(), reason: '手工触发', revision: false })
const options = computed(() =>
  props.plans.map(plan => ({
    label: `${plan.source_code} · v${plan.active_version}`,
    value: plan.id,
  })),
)
const rules = {
  plan: { required: true, type: 'number' as const, message: '请选择计划' },
  day: { required: true, pattern: /^\d{4}-\d{2}-\d{2}$/, message: '业务日期格式应为 YYYY-MM-DD' },
  reason: { required: true, whitespace: true, message: '请填写触发原因' },
}
const { form, validate } = useFormSubmit(() => {
  if (draft.plan !== null) {
    emit('submit', { ...draft, plan: draft.plan, reason: draft.reason.trim() })
  }
})
</script>
<template>
  <NForm
    ref="form"
    :model="draft"
    :rules="rules"
    label-placement="top"
    @submit.prevent="validate"
  >
    <div class="form-grid">
      <NFormItem label="计划" path="plan" :label-props="{ for: `${id}-plan` }">
        <NSelect
          v-model:value="draft.plan"
          :options="options"
          filterable
          :disabled="busy"
          :input-props="{ id: `${id}-plan`, 'aria-label': '计划' }"
        />
      </NFormItem>
      <NFormItem label="业务日期" path="day" :label-props="{ for: `${id}-day` }">
        <NInput v-model:value="draft.day" :disabled="busy" :input-props="{ 'aria-label': '业务日期', id: `${id}-day` }" />
      </NFormItem>
      <NFormItem label="触发原因" path="reason" :label-props="{ for: `${id}-reason` }">
        <NInput
          v-model:value="draft.reason"
          :disabled="busy"
          :input-props="{ 'aria-label': '触发原因', id: `${id}-reason` }"
        />
      </NFormItem>
      <NFormItem label="生成新修订">
        <NCheckbox v-model:checked="draft.revision" :disabled="busy">
          生成新修订
        </NCheckbox>
      </NFormItem>
    </div>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
