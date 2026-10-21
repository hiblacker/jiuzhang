<script setup lang="ts">
import {
  NCheckbox,
  NCheckboxGroup,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NFormItemGi,
  NGrid,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Model } from '@/shared/api/types'
import DatasetFields from './DatasetFields.vue'
import DatasetGraph from './DatasetGraph.vue'

const definition = defineModel<Model<'DatasetInput'>['definition']>({ required: true })
defineProps<{ disabled: boolean }>()
const { t } = useI18n()
</script>
<template>
  <div class="processing-settings">
    <DatasetFields
      :model-value="definition.fields"
      @update:model-value="definition = { ...definition, fields: $event }"
      :readonly="disabled"
    >
      <template #mask-policy="props"><slot name="mask-policy" v-bind="props" /></template>
    </DatasetFields>
    <NForm label-placement="top" :disabled="disabled" class="processing-rules">
      <NFormItem :label="t('ui.dataset_editor_16fda324')">
        <NCheckboxGroup
          :value="definition.cleaning"
          @update:value="
            definition = {
              ...definition,
              cleaning: $event.filter(
                (item) => item === 'trim' || item === 'fill-null' || item === 'deduplicate',
              ),
            }
          "
          :aria-label="t('ui.dataset_editor_16fda324')"
        >
          <NCheckbox value="trim">{{ t('ui.dataset_editor_d9f06fea') }}</NCheckbox>
        </NCheckboxGroup>
      </NFormItem>
      <NCollapse :default-expanded-names="['governance']">
        <NCollapseItem name="governance" :title="t('datasets.editor.governance')">
          <NGrid :cols="2" :x-gap="20">
            <NFormItemGi :label="t('ui.dataset_editor_e974beee')"
              ><slot name="quality"
            /></NFormItemGi>
            <NFormItemGi :label="t('ui.dataset_editor_3792a310')"
              ><slot name="masking"
            /></NFormItemGi>
          </NGrid>
          <p class="muted">{{ t('datasets.sampleHint') }}</p>
        </NCollapseItem>
        <NCollapseItem
          v-if="definition.mode === 'visual'"
          name="graph"
          :title="t('datasets.editor.visualProcessing')"
        >
          <DatasetGraph
            :nodes="definition.nodes"
            :edges="definition.edges"
            @update:nodes="definition = { ...definition, nodes: $event }"
            @update:edges="definition = { ...definition, edges: $event }"
            :readonly="disabled"
          />
        </NCollapseItem>
      </NCollapse>
    </NForm>
  </div>
</template>
<style scoped>
.processing-rules {
  margin-top: 24px;
}
</style>
