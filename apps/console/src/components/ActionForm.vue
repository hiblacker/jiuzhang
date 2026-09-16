<script setup lang="ts">
import { reactive, ref, useId } from 'vue'
import {
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NAlert,
} from 'naive-ui'
import { type Field, type Row } from '../types'
const props = defineProps<{
  fields: Field[]
  initial?: Row
  submitLabel?: string
  busy?: boolean
}>()
const emit = defineEmits<{ submit: [value: Row] }>()
const prefix = useId()
const fieldId = (key: string) => `${prefix}-field-${key}`
const values = reactive<Row>(
  Object.fromEntries(
    props.fields.map((f) => {
      const value = props.initial?.[f.key]
      return [
        f.key,
        f.type === 'json'
          ? JSON.stringify(value ?? {}, null, 2)
          : (value ?? (f.type === 'switch' ? false : f.type === 'number' ? null : '')),
      ]
    }),
  ),
)
const validation = ref('')
function submit() {
  validation.value = ''
  const result: Row = {}
  try {
    for (const field of props.fields) {
      const value = values[field.key]
      if (field.required && (value == null || (typeof value === 'string' && !value.trim()))) {
        throw new Error(`请填写${field.label}`)
      }
      if (
        field.type === 'number'
        && value != null
        && (Number(value) < (field.min ?? -Infinity) || Number(value) > (field.max ?? Infinity))
      ) {
        throw new Error(`${field.label}超出范围`)
      }
      if (field.type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        throw new Error(`${field.label}格式应为 YYYY-MM-DD`)
      }
      if (field.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(value))) {
        throw new Error(`${field.label}格式应为 HH:mm`)
      }
      if (field.type === 'json') {
        try {
          result[field.key] = JSON.parse(String(value))
        }
        catch {
          throw new Error(`${field.label}不是有效 JSON`)
        }
      }
      else {
        result[field.key] = typeof value === 'string' ? value.trim() : value
      }
    }
    emit('submit', result)
  }
  catch (e) {
    validation.value = (e as Error).message
  }
}
</script>

<template>
  <NForm label-placement="top" @submit.prevent="submit">
    <NAlert v-if="validation" type="error" class="form-error">
      {{ validation }}
    </NAlert>
    <div class="form-grid">
      <NFormItem
        v-for="field in fields"
        :key="field.key"
        :label="field.label"
        :label-props="{ for: fieldId(field.key) }"
        :required="field.required"
        :class="{ 'full-width': ['json', 'textarea'].includes(field.type ?? '') }"
      >
        <NSelect
          v-if="field.type === 'select'"
          :value="values[field.key] as string | number"
          :options="field.options"
          filterable
          :disabled="busy || field.disabled"
          :input-props="{ id: fieldId(field.key), 'aria-label': field.label }"
          @update:value="values[field.key] = $event"
        />
        <NInputNumber
          v-else-if="field.type === 'number'"
          :value="values[field.key] as number | null"
          :min="field.min"
          :max="field.max"
          :precision="0"
          :disabled="busy || field.disabled"
          :input-props="{ id: fieldId(field.key), 'aria-label': field.label }"
          @update:value="values[field.key] = $event"
        />
        <NCheckbox
          v-else-if="field.type === 'switch'"
          :checked="Boolean(values[field.key])"
          :disabled="busy || field.disabled"
          @update:checked="values[field.key] = $event"
        >
          {{ field.label }}
        </NCheckbox>
        <NInput
          v-else
          :value="String(values[field.key] ?? '')"
          :type="['json', 'textarea'].includes(field.type ?? '') ? 'textarea' : 'text'"
          :autosize="
            ['json', 'textarea'].includes(field.type ?? '')
              ? { minRows: field.type === 'json' ? 5 : 2, maxRows: 14 }
              : false
          "
          :disabled="busy || field.disabled"
          :input-props="{ id: fieldId(field.key), 'aria-label': field.label, autocomplete: 'off' }"
          @update:value="values[field.key] = $event"
        />
      </NFormItem>
    </div>
    <NSpace justify="end">
      <NButton attr-type="submit" type="primary" :loading="busy">
        {{ submitLabel ?? '保存' }}
      </NButton>
    </NSpace>
  </NForm>
</template>
