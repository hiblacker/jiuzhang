<script setup lang="ts">
import { NAlert, NFormItem, NFormItemGi, NGrid, NInput, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Model } from '@/shared/api/types'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import DatasetOutputSummary from './DatasetOutputSummary.vue'
const definition = defineModel<Model<'DatasetInput'>['definition']>({ required: true })
defineProps<{
  locked: boolean
  disabled: boolean
  subjectDomainLabel: string
  subjectDomainHint: string
}>()
const { t } = useI18n()
function updateOutput(patch: Partial<Model<'DatasetInput'>['definition']['output']>) {
  definition.value = {
    ...definition.value,
    output: { ...definition.value.output, ...patch },
  }
}
</script>
<template>
  <NFormItem :label="t('datasets.deliveryMode')">
    <NSelect
      :value="definition.deliveryMode"
      @update:value="definition = { ...definition, deliveryMode: $event }"
      v-select-trigger-name="t('datasets.deliveryMode')"
      :disabled="disabled || locked"
      :options="[
        { label: t('datasets.directMode'), value: 'direct' },
        { label: t('datasets.warehouseMode'), value: 'warehouse' },
      ]"
    />
  </NFormItem>
  <NAlert v-if="definition.deliveryMode === 'direct'" type="info">{{
    t('datasets.directHelp')
  }}</NAlert>
  <template v-else>
    <NFormItem :label="subjectDomainLabel">
      <NInput
        :value="definition.output.subjectDomain"
        @update:value="updateOutput({ subjectDomain: $event })"
        :maxlength="60"
        :input-props="{ 'aria-label': subjectDomainLabel }"
        :placeholder="subjectDomainHint"
      />
    </NFormItem>
    <NGrid :cols="2" :x-gap="20">
      <NFormItemGi :label="t('ui.dataset_editor_2bee776c')">
        <NSelect
          :value="definition.output.layer"
          @update:value="updateOutput({ layer: $event })"
          v-select-trigger-name="t('ui.dataset_editor_2bee776c')"
          :options="['ODS', 'DWD', 'DWS', 'ADS'].map((value) => ({ label: value, value }))"
        />
      </NFormItemGi>
      <NFormItemGi :label="t('ui.dataset_editor_442be9c4')">
        <NInput
          :value="definition.output.table"
          @update:value="updateOutput({ table: $event })"
          :disabled="disabled || locked"
          :input-props="{ 'aria-label': t('ui.dataset_editor_442be9c4') }"
          placeholder="dwd_orders"
        />
      </NFormItemGi>
      <NFormItemGi :label="t('ui.dataset_editor_167a31ec')">
        <NSelect
          :value="definition.output.writeMode"
          @update:value="updateOutput({ writeMode: $event })"
          v-select-trigger-name="t('ui.dataset_editor_167a31ec')"
          :options="[{ label: t('ui.dataset_editor_855241c2'), value: 'replace' }]"
        />
      </NFormItemGi>
      <NFormItemGi :label="t('ui.dataset_editor_fd37952d')">
        <NSelect
          :value="definition.output.keys"
          @update:value="updateOutput({ keys: $event })"
          v-select-trigger-name="t('ui.dataset_editor_fd37952d')"
          multiple
          clearable
          :options="
            definition.fields
              .filter((f) => f.output)
              .map((f) => ({ label: f.target, value: f.target }))
          "
        />
      </NFormItemGi>
    </NGrid>
    <DatasetOutputSummary :output="definition.output" />
    <p class="muted">{{ t('datasets.scheduleUnsupported') }}</p>
  </template>
</template>
