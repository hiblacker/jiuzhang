<script setup lang="ts">
import { computed, reactive, useId } from 'vue'
import {
  NAlert,
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
} from 'naive-ui'
import type { FormRules } from 'naive-ui'
import { jsonObject, useFormSubmit } from '../../shared/forms'
import { today } from '../../shared/types'
import type { Plan, Source } from '../../shared/types'
import type { PlanInput } from './api'

const props = defineProps<{ plan: Plan | null, plans: Plan[], sources: Source[], busy: boolean }>()
const emit = defineEmits<{ submit: [input: PlanInput] }>()
const id = useId()
const initial = props.plan
const draft = reactive({
  sourceCode: initial?.source_code ?? '',
  kind: initial?.kind ?? 'MYSQL_SNAPSHOT',
  runtimeRef: initial?.runtime_ref ?? '',
  inventoryVersion: initial?.inventory_version ?? null,
  startDate: initial?.start_date ?? today(),
  triggerTime: initial?.trigger_time ?? '02:00',
  timezone: initial?.timezone ?? 'Asia/Shanghai',
  maxAttempts: initial?.max_attempts ?? 3,
  timeoutSeconds: initial?.timeout_seconds ?? 3600,
  historicalRead: initial?.historical_read ?? false,
  contract: JSON.stringify(initial?.contract ?? {}, null, 2),
})
const required = { required: true, whitespace: true, message: '此项必填' }
const rules: FormRules = {
  sourceCode: required,
  kind: required,
  runtimeRef: required,
  startDate: [required, { pattern: /^\d{4}-\d{2}-\d{2}$/, message: '开始日期格式应为 YYYY-MM-DD' }],
  triggerTime: [
    required,
    { pattern: /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, message: '每日触发时间格式应为 HH:mm' },
  ],
  maxAttempts: {
    type: 'number',
    required: true,
    min: 1,
    max: 8,
    message: '最多尝试次数应为 1 到 8',
  },
  timeoutSeconds: {
    type: 'number',
    required: true,
    min: 30,
    max: 86400,
    message: '运行上限应为 30 到 86400 秒',
  },
}
const sources = computed(() =>
  props.sources.map(source => ({ label: source.code, value: source.code })),
)
const kinds = [
  { label: '数据库全量快照', value: 'MYSQL_SNAPSHOT' },
  { label: '目录文件', value: 'FILE_SCAN' },
  { label: 'REST API', value: 'REST_PULL' },
]
const zones = ['Asia/Shanghai', 'UTC'].map(value => ({ label: value, value }))
const { form, validation, validate } = useFormSubmit(() => {
  if (draft.kind === 'MYSQL_SNAPSHOT' && !draft.inventoryVersion) {
    throw new Error('数据库计划必须指定清单版本')
  }
  emit('submit', {
    ...draft,
    runtimeRef: draft.runtimeRef.trim(),
    contract: jsonObject(draft.contract, '交付契约'),
    expectedVersion:
      initial?.active_version
      ?? props.plans.find(plan => plan.source_code === draft.sourceCode)?.active_version
      ?? 0,
    triggerTime: draft.triggerTime.length === 5 ? `${draft.triggerTime}:00` : draft.triggerTime,
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
    <div class="form-grid">
      <NFormItem label="来源" path="sourceCode" :label-props="{ for: `${id}-source` }">
        <NSelect
          v-model:value="draft.sourceCode"
          :options="sources"
          filterable
          :disabled="busy || !!plan"
          :input-props="{ id: `${id}-source`, 'aria-label': '来源' }"
        />
      </NFormItem>
      <NFormItem label="接入方式" path="kind" :label-props="{ for: `${id}-kind` }">
        <NSelect
          v-model:value="draft.kind"
          filterable
          :options="kinds"
          :disabled="busy"
          :input-props="{ id: `${id}-kind`, 'aria-label': '接入方式' }"
        />
      </NFormItem>
      <NFormItem label="执行配置名" path="runtimeRef" :label-props="{ for: `${id}-runtime` }">
        <NInput
          v-model:value="draft.runtimeRef"
          :disabled="busy"
          :input-props="{ 'aria-label': '执行配置名', id: `${id}-runtime` }"
        />
      </NFormItem>
      <NFormItem label="数据库清单版本" :label-props="{ for: `${id}-inventory` }">
        <NInputNumber
          v-model:value="draft.inventoryVersion"
          :min="1"
          :precision="0"
          :disabled="busy"
          :input-props="{ 'aria-label': '数据库清单版本', id: `${id}-inventory` }"
        />
      </NFormItem>
      <NFormItem label="开始日期" path="startDate" :label-props="{ for: `${id}-date` }">
        <NInput
          v-model:value="draft.startDate"
          :disabled="busy"
          :input-props="{ 'aria-label': '开始日期', id: `${id}-date` }"
        />
      </NFormItem>
      <NFormItem label="每日触发时间" path="triggerTime" :label-props="{ for: `${id}-time` }">
        <NInput
          v-model:value="draft.triggerTime"
          :disabled="busy"
          :input-props="{ 'aria-label': '每日触发时间', id: `${id}-time` }"
        />
      </NFormItem>
      <NFormItem label="时区" :label-props="{ for: `${id}-zone` }">
        <NSelect
          v-model:value="draft.timezone"
          filterable
          :options="zones"
          :disabled="busy"
          :input-props="{ id: `${id}-zone`, 'aria-label': '时区' }"
        />
      </NFormItem>
      <NFormItem label="最多尝试次数" path="maxAttempts" :label-props="{ for: `${id}-attempts` }">
        <NInputNumber
          v-model:value="draft.maxAttempts"
          :min="1"
          :max="8"
          :precision="0"
          :disabled="busy"
          :input-props="{ 'aria-label': '最多尝试次数', id: `${id}-attempts` }"
        />
      </NFormItem>
      <NFormItem
        label="运行上限（秒）"
        path="timeoutSeconds"
        :label-props="{ for: `${id}-timeout` }"
      >
        <NInputNumber
          v-model:value="draft.timeoutSeconds"
          :min="30"
          :max="86400"
          :precision="0"
          :disabled="busy"
          :input-props="{ 'aria-label': '运行上限（秒）', id: `${id}-timeout` }"
        />
      </NFormItem>
      <NFormItem label="来源允许重读过去日期">
        <NCheckbox v-model:checked="draft.historicalRead" :disabled="busy">
          来源允许重读过去日期
        </NCheckbox>
      </NFormItem>
      <NFormItem label="交付契约" class="full-width" :label-props="{ for: `${id}-contract` }">
        <NInput
          v-model:value="draft.contract"
          type="textarea"
          :autosize="{ minRows: 5, maxRows: 14 }"
          :disabled="busy"
          :input-props="{ 'aria-label': '交付契约', id: `${id}-contract` }"
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
