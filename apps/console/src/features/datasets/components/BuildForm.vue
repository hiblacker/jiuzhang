<script setup lang="ts">
import { computed, reactive, useId } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NSelect } from 'naive-ui'
import { jsonObject, useFormSubmit } from '../../../shared/forms'
import type { BuildInput, ModelVersion } from '../types'

const props = defineProps<{ versions: ModelVersion[], version: number, busy: boolean }>()
const emit = defineEmits<{ submit: [value: BuildInput] }>()
const id = useId()
const requestKey = crypto.randomUUID()
const draft = reactive({ modelVersion: props.version, inputs: '{}' })
const options = computed(() =>
  props.versions.map(item => ({ label: `v${item.version}`, value: item.version })),
)
const rules = {
  modelVersion: { type: 'number' as const, required: true, message: '请选择模型版本' },
}
const { form, validation, validate } = useFormSubmit(() =>
  emit('submit', {
    modelVersion: draft.modelVersion,
    inputs: jsonObject(draft.inputs, '输入资产'),
    requestKey,
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
    <NFormItem label="模型版本" path="modelVersion" :label-props="{ for: `${id}-version` }">
      <NSelect
        v-model:value="draft.modelVersion"
        filterable
        :options="options"
        :disabled="busy"
        :input-props="{ id: `${id}-version`, 'aria-label': '模型版本' }"
      />
    </NFormItem>
    <NFormItem label="输入资产（别名与资产 ID）" :label-props="{ for: `${id}-inputs` }">
      <NInput
        v-model:value="draft.inputs"
        type="textarea"
        :autosize="{ minRows: 5, maxRows: 14 }"
        :disabled="busy"
        :input-props="{ 'aria-label': '输入资产（别名与资产 ID）', id: `${id}-inputs` }"
      />
    </NFormItem>
    <div class="form-actions">
      <NButton type="primary" attr-type="submit" :loading="busy">
        确认提交
      </NButton>
    </div>
  </NForm>
</template>
