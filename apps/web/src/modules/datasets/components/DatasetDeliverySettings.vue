<script setup lang="ts">
import { ref } from 'vue'
import { NAlert, NButton, NFormItem, NInput, NRadio, NRadioGroup, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Model } from '@/shared/api/types'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
const definition = defineModel<Model<'DatasetInput'>['definition']>({ required: true })
defineProps<{
  locked: boolean
  disabled: boolean
  subjectDomainLabel: string
  subjectDomainHint: string
  publishedOutput?: Model<'Output'>
  publishedVersion?: number
}>()
const { t } = useI18n()
const more = ref(false)
function updateOutput(patch: Partial<Model<'DatasetInput'>['definition']['output']>) {
  definition.value = {
    ...definition.value,
    output: { ...definition.value.output, ...patch },
  }
}
</script>
<template>
  <div class="delivery-settings">
    <div class="identity-settings">
      <slot name="identity" />
      <NFormItem :label="t('datasets.deliveryMode')" :show-feedback="false">
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
      <NButton
        text
        :disabled="disabled"
        :aria-expanded="more"
        aria-controls="dataset-more-information"
        @click="more = !more"
        >{{
          more ? t('datasets.editor.lessInformation') : t('datasets.editor.moreInformation')
        }}</NButton
      >
    </div>
    <div v-if="more" id="dataset-more-information" class="metadata-settings">
      <slot name="metadata" />
      <NFormItem :label="subjectDomainLabel" :show-feedback="false">
        <NInput
          :value="definition.output.subjectDomain"
          @update:value="updateOutput({ subjectDomain: $event })"
          :maxlength="60"
          :input-props="{ 'aria-label': subjectDomainLabel }"
          :placeholder="subjectDomainHint"
        />
      </NFormItem>
      <NFormItem
        v-if="definition.deliveryMode === 'warehouse'"
        :label="t('datasets.output.keys')"
        :show-feedback="false"
      >
        <NSelect
          :value="definition.output.keys"
          @update:value="updateOutput({ keys: $event })"
          v-select-trigger-name="t('datasets.output.keys')"
          multiple
          clearable
          :options="
            definition.fields
              .filter((f) => f.output)
              .map((f) => ({ label: f.target, value: f.target }))
          "
        />
      </NFormItem>
    </div>
    <NAlert v-if="definition.deliveryMode === 'direct'" type="info" :show-icon="false">{{
      t('datasets.directHelp')
    }}</NAlert>
    <section v-else :aria-label="t('datasets.editor.warehouseSettings')" class="warehouse-settings">
      <NFormItem :label="t('ui.dataset_editor_2bee776c')" :show-feedback="false">
        <NSelect
          :value="definition.output.layer"
          @update:value="updateOutput({ layer: $event })"
          v-select-trigger-name="t('ui.dataset_editor_2bee776c')"
          :options="['ODS', 'DWD', 'DWS', 'ADS'].map((value) => ({ label: value, value }))"
        />
      </NFormItem>
      <NFormItem :label="t('ui.dataset_editor_442be9c4')" :show-feedback="false">
        <NInput
          :value="definition.output.table"
          @update:value="updateOutput({ table: $event })"
          :disabled="disabled || locked"
          :input-props="{ 'aria-label': t('ui.dataset_editor_442be9c4') }"
          placeholder="dwd_orders"
        />
      </NFormItem>
      <NFormItem :label="t('datasets.output.mode')" :show-feedback="false">
        <NRadioGroup
          :value="definition.output.writeMode"
          :disabled="disabled"
          :aria-label="t('datasets.output.mode')"
          @update:value="updateOutput({ writeMode: $event })"
        >
          <NRadio value="replace">{{ t('datasets.output.replace') }}</NRadio>
          <NRadio value="append">{{ t('datasets.output.append') }}</NRadio>
        </NRadioGroup>
      </NFormItem>
      <div class="output-explanation" aria-live="polite">
        <p>
          {{
            definition.output.writeMode === 'append'
              ? t('datasets.output.appendHelp')
              : t('datasets.output.replaceHelp')
          }}
        </p>
        <p v-if="publishedOutput">
          {{
            t('datasets.output.activeVersion', {
              version: publishedVersion,
              mode:
                publishedOutput.writeMode === 'append'
                  ? t('datasets.output.append')
                  : t('datasets.output.replace'),
            })
          }}<span v-if="publishedOutput.writeMode !== definition.output.writeMode">
            · {{ t('datasets.output.pendingChange') }}</span
          >
        </p>
        <p
          v-if="
            publishedOutput?.writeMode === 'append' && definition.output.writeMode === 'replace'
          "
          class="replacement-warning"
        >
          {{ t('datasets.output.replaceWarning') }}
        </p>
      </div>
    </section>
  </div>
</template>
<style scoped>
.delivery-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.identity-settings {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px auto;
  gap: 20px;
  align-items: center;
}
.metadata-settings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 20px;
}
.warehouse-settings {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) 300px;
  gap: 8px 20px;
}
.output-explanation {
  grid-column: 1 / -1;
  color: var(--textSecondary);
}
.output-explanation p {
  margin: 0;
}
.replacement-warning {
  color: var(--warning);
}
</style>
