<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { ref, computed, nextTick, toRaw } from 'vue'
import {
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NInputNumber,
  NButton,
  NSwitch,
  type FormInst,
  type FormRules,
} from 'naive-ui'
import type { Model } from '@/shared/api/types'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
const model = defineModel<Model<'ServiceInput'>>({ required: true })
const props = defineProps<{
  table?: Model<'Table'>
  disabled?: boolean
  definitionReadonly?: boolean
}>()
const form = ref<FormInst | null>(null)
const parameterRoot = ref<HTMLElement | null>(null)
const parameterKeys = new WeakMap<Model<'ServiceInput'>['parameters'][number], number>()
let nextParameterKey = 0
function parameterKey(parameter: Model<'ServiceInput'>['parameters'][number]) {
  const raw = toRaw(parameter)
  if (!parameterKeys.has(raw)) parameterKeys.set(raw, ++nextParameterKey)
  return parameterKeys.get(raw)!
}
async function addParameter() {
  if (props.disabled || props.definitionReadonly) return
  model.value.parameters.push({ name: '', type: 'string', required: false })
  await nextTick()
  parameterRoot.value
    ?.querySelector<HTMLElement>('[data-parameter-row]:last-of-type input')
    ?.focus()
}
async function removeParameter(index: number) {
  if (props.disabled || props.definitionReadonly) return
  model.value.parameters.splice(index, 1)
  await nextTick()
  const root = parameterRoot.value
  if (!root) return
  if (model.value.parameters.length === 0) {
    root.querySelector<HTMLElement>('[data-add-parameter]')?.focus()
    return
  }
  root
    .querySelectorAll('[data-parameter-row]')
    [Math.min(index, model.value.parameters.length - 1)]?.querySelector<HTMLElement>('input')
    ?.focus()
}

const rules = computed<FormRules>(() => ({
  name: { required: true, whitespace: true, message: uiText('required'), trigger: 'blur' },
  tableId: { required: true, message: uiText('required'), trigger: 'change' },
  fields: {
    type: 'array',
    required: !props.definitionReadonly,
    min: props.definitionReadonly ? 0 : 1,
    message: uiText('required'),
    trigger: 'change',
  },
  allowedRoles: {
    type: 'array',
    required: true,
    min: 1,
    message: uiText('required'),
    trigger: 'change',
  },
}))
defineExpose({ validate: () => form.value?.validate() })
function selectTable(id: string) {
  if (id === model.value.tableId) return
  model.value.tableId = id
  model.value.fields = []
  model.value.parameters = []
  model.value.sortField = ''
}
</script>
<template>
  <NForm ref="form" :model="model" :rules="rules" :disabled="disabled" label-placement="top"
    ><NFormItem path="name" :label="uiText('ui.service_form_d82acb1b')" required
      ><NInput
        v-model:value="model.name"
        :input-props="{ 'aria-label': uiText('ui.service_form_d82acb1b') }"
        :placeholder="uiText('ui.service_form_d82acb1b')" /></NFormItem
    ><NFormItem path="tableId" :label="uiText('ui.service_form_f4959de3')" required
      ><slot
        name="table"
        :select="selectTable"
        :disabled="disabled || definitionReadonly" /></NFormItem
    ><NFormItem path="fields" :label="uiText('ui.service_form_adf908d5')" required
      ><NSelect
        v-model:value="model.fields"
        v-select-trigger-name="uiText('ui.service_form_adf908d5')"
        :disabled="disabled || definitionReadonly"
        multiple
        :options="
          table?.fields.filter((f) => f.output).map((f) => ({ value: f.target, label: f.target }))
        " /></NFormItem
    ><NFormItem :label="uiText('ui.service_form_5b478c47')"
      ><div ref="parameterRoot" class="parameters">
        <div
          v-for="(param, index) in model.parameters"
          :key="parameterKey(param)"
          class="parameter"
          data-parameter-row
        >
          <NInput
            v-model:value="param.name"
            :input-props="{ 'aria-label': uiText('services.parameterName', { index: index + 1 }) }"
            :disabled="disabled || definitionReadonly"
            :placeholder="uiText('ui.service_form_ecb6c72b')"
          /><NSelect
            v-model:value="param.type"
            v-select-trigger-name="uiText('services.parameterType', { index: index + 1 })"
            :disabled="disabled || definitionReadonly"
            :options="[
              { label: uiText('ui.service_form_4dc9621a'), value: 'string' },
              { label: uiText('ui.service_form_52152364'), value: 'number' },
            ]"
          /><NSwitch
            v-model:value="param.required"
            :aria-label="uiText('services.parameterRequired', { index: index + 1 })"
            :disabled="disabled || definitionReadonly"
            ><template #checked>{{ uiText('ui.service_form_32945d3e') }}</template
            ><template #unchecked>{{ uiText('ui.service_form_53e32830') }}</template></NSwitch
          ><NButton
            quaternary
            :disabled="disabled || definitionReadonly"
            :aria-label="uiText('services.removeParameter', { index: index + 1 })"
            @click="removeParameter(index)"
            >{{ uiText('ui.service_form_2f752c00') }}</NButton
          >
        </div>
        <NButton
          dashed
          :disabled="disabled || definitionReadonly"
          data-add-parameter
          @click="addParameter"
          >{{ uiText('ui.service_form_4be7020c') }}</NButton
        >
      </div></NFormItem
    ><NFormItem :label="uiText('ui.service_form_99a9bccb')"
      ><NInputNumber
        v-model:value="model.pageSize"
        :input-props="{ 'aria-label': uiText('ui.service_form_99a9bccb') }"
        :min="1"
        :max="100" /></NFormItem
    ><NFormItem :label="uiText('ui.service_form_52aff3c1')"
      ><NSelect
        :value="model.sortField || null"
        v-select-trigger-name="uiText('ui.service_form_52aff3c1')"
        :disabled="disabled || definitionReadonly"
        @update:value="model.sortField = $event ?? ''"
        clearable
        :options="model.fields.map((value) => ({ value, label: value }))" /></NFormItem
    ><NFormItem path="allowedRoles" :label="uiText('ui.service_form_7af3f79a')"
      ><NSelect
        v-model:value="model.allowedRoles"
        v-select-trigger-name="uiText('ui.service_form_7af3f79a')"
        multiple
        :options="[
          { value: 'admin', label: uiText('ui.service_form_ef84e765') },
          { value: 'developer', label: uiText('ui.service_form_3e1274e4') },
          { value: 'viewer', label: uiText('ui.service_form_53ae4414') },
        ]" /></NFormItem
    ><NFormItem :label="uiText('ui.service_form_26670dda')"
      ><NInput
        v-model:value="model.description"
        :input-props="{ 'aria-label': uiText('ui.service_form_26670dda') }"
        type="textarea" /></NFormItem
  ></NForm>
</template>
<style scoped>
.parameters {
  width: 100%;
}
.parameter {
  display: grid;
  grid-template-columns: 1fr 130px 60px 60px;
  gap: 12px;
  margin-bottom: 12px;
  align-items: center;
}
@media (max-width: 760px) {
  .parameter {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
