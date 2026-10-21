<script setup lang="ts">
import { useCan } from '@/shared/security/permissions'
const canReadSensitive = useCan('readSensitive')
import { TagEditor } from '@/shared/ui/tag-editor'
import { vAccessibleTabs } from '@/shared/ui/accessible-tabs'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useRouteTab } from '@/shared/composables/use-route-tab'
import { DataPreview } from '@/shared/ui/data-preview'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NTabs,
  NTabPane,
  NCheckboxGroup,
  NCheckbox,
  NDataTable,
  NAlert,
  NCollapse,
  NCollapseItem,
  NGrid,
  NFormItemGi,
  type FormInst,
} from 'naive-ui'
import {
  useDatasetEditor,
  sourceFieldType,
  DatasetFields,
  DatasetGraph,
  DatasetSqlWorkspace,
  DatasetOutputSummary,
} from '@/modules/datasets'
import { SourcePicker, SourceObjectList, useSourceObjects } from '@/modules/sources'
import { GovernanceBindingSelect } from '@/modules/governance'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { CopyButton } from '@/shared/ui/copy-button'
const route = useRoute(),
  router = useRouter(),
  { t } = useI18n()
const id = computed(() => String(route.params.id ?? ''))
const { query, draft, dirty, save, preview } = useDatasetEditor(id)
const objects = useSourceObjects(() => draft.value.definition.sourceId)
const busy = computed(() => save.isPending.value || preview.isPending.value)
const basicExpanded = ref<string[]>([])
const referenceId = ref('')
const referenceObject = computed(
  () =>
    objects.data.value?.find((object) => object.id === referenceId.value) ??
    objects.data.value?.[0],
)
watch(
  () => draft.value.definition.sourceId,
  () => {
    referenceId.value = ''
  },
)
const previewReady = computed(() => {
  const definition = draft.value.definition
  if (!definition.sourceId) return false
  if (definition.mode === 'sql') return !!definition.sql.trim()
  return (
    !!definition.objectId &&
    !objects.isFetching.value &&
    definition.fields.some((field) => field.output)
  )
})
const saveReady = computed(
  () =>
    previewReady.value &&
    draft.value.definition.fields.some((field) => field.output) &&
    preview.sqlSchemaCurrent.value &&
    !busy.value,
)
const form = ref<FormInst>(),
  tab = useRouteTab(['input', 'fields', 'governance', 'schedule', 'output', 'preview'], 'input')
watch([() => draft.value.definition.mode, () => tab.value], ([mode, currentTab]) => {
  if (mode === 'sql' && currentTab === 'preview') tab.value = 'input'
})
if (!id.value) {
  draft.value.definition.sourceId = String(route.query.sourceId ?? '')
  draft.value.definition.objectId = String(route.query.objectId ?? '')
}
watch(
  [
    () => objects.data.value,
    () => draft.value.definition.mode,
    () => draft.value.definition.objectId,
  ],
  ([items, mode, objectId]) => {
    if (mode !== 'visual') return
    const object = items?.find((x) => x.id === objectId)
    if (object && !draft.value.definition.fields.length)
      draft.value.definition.fields = object.fields.map((field) => ({
        ...field,
        type: sourceFieldType(field.type),
        output:
          !id.value && typeof route.query.field === 'string'
            ? field.name === route.query.field
            : field.output,
      }))
  },
  { immediate: true },
)
function selectSource(value: string) {
  draft.value.definition.sourceId = value
  draft.value.definition.objectId = ''
  draft.value.definition.fields = []
}
function selectObject(value: string) {
  draft.value.definition.objectId = value
  const object = objects.data.value?.find((x) => x.id === value)
  if (object)
    draft.value.definition.fields = object.fields.map((field) => ({
      ...field,
      type: sourceFieldType(field.type),
    }))
}
function selectDefinitionMode(value: 'visual' | 'sql') {
  if (draft.value.definition.mode === value) return
  draft.value.definition.mode = value
  if (tab.value === 'preview') tab.value = 'input'
  draft.value.definition.fields = []
  if (value === 'sql') draft.value.definition.objectId = ''
}
async function submit() {
  if (save.isPending.value || !saveReady.value) return
  if (!draft.value.name.trim()) {
    basicExpanded.value = ['basic']
    await nextTick()
  }
  try {
    await form.value?.validate()
  } catch {
    basicExpanded.value = ['basic']
    return
  }
  if (save.isPending.value) return
  try {
    const d = await save.mutateAsync()
    await router.push('/datasets/' + d.id)
  } catch {}
}
async function showPreview() {
  if (!previewReady.value || busy.value) return
  const success = await preview.run()
  if (success && draft.value.definition.mode === 'visual') tab.value = 'preview'
}
useEditGuard(dirty, save.isPending)
</script>
<template>
  <PageHeader
    :title="id ? uiText('ui.dataset_editor_3dabd36c') : uiText('ui.dataset_editor_e78bd5fa')"
    class="dataset-editor-header"
    ><NButton
      :disabled="save.isPending.value"
      @click="router.push(id ? '/datasets/' + id : '/datasets')"
      >{{ uiText('ui.dataset_editor_4d0b4688') }}</NButton
    ><NButton
      v-if="draft.definition.mode === 'visual'"
      :disabled="!canReadSensitive || !previewReady || save.isPending.value"
      :loading="preview.isPending.value"
      @click="showPreview"
      >{{ uiText('ui.dataset_editor_350d00d1') }}</NButton
    ><NButton
      type="primary"
      :disabled="!saveReady"
      :loading="save.isPending.value"
      @click="submit"
      >{{ uiText('ui.dataset_editor_4cd30ef9') }}</NButton
    ></PageHeader
  ><AsyncState
    :loading="!!id && query.isLoading.value"
    :error="query.error.value"
    @retry="query.refetch()"
    ><NCard :bordered="false" class="dataset-editor-card"
      ><NForm
        ref="form"
        :model="draft"
        :rules="{
          name: { required: true, message: uiText('ui.dataset_editor_505e9598'), trigger: 'blur' },
        }"
        label-placement="top"
        :disabled="busy"
        ><NCollapse v-model:expanded-names="basicExpanded" class="basic-settings">
          <NCollapseItem
            name="basic"
            :title="t('datasets.basicSettings') + (draft.name ? ' · ' + draft.name : '')"
            display-directive="show"
          >
            <NGrid cols="1 640:2 960:3" responsive="self" :x-gap="24"
              ><NFormItemGi :label="uiText('ui.dataset_editor_5aa625bf')" path="name"
                ><NInput
                  v-model:value="draft.name"
                  :input-props="{ 'aria-label': uiText('ui.dataset_editor_5aa625bf') }"
                  :placeholder="uiText('ui.dataset_editor_5aa625bf')" /></NFormItemGi
              ><NFormItemGi :label="uiText('ui.dataset_editor_974d383f')"
                ><NInput
                  v-model:value="draft.owner"
                  :input-props="{
                    'aria-label': uiText('ui.dataset_editor_974d383f'),
                  }" /></NFormItemGi
              ><NFormItemGi :label="uiText('ui.dataset_editor_ae0a7afe')"
                ><TagEditor v-model="draft.tags" :disabled="busy" /></NFormItemGi></NGrid
            ><NFormItem :label="uiText('ui.dataset_editor_26670dda')"
              ><NInput
                v-model:value="draft.description"
                :input-props="{
                  'aria-label': uiText('ui.dataset_editor_26670dda'),
                }" /></NFormItem></NCollapseItem></NCollapse
        ><NTabs
          v-accessible-tabs="uiText('ui.dataset_editor_3dabd36c')"
          v-model:value="tab"
          type="line"
          animated
          ><NTabPane name="input" :tab="uiText('ui.dataset_editor_f0f6fbb8')">
            <NGrid
              :cols="draft.definition.mode === 'sql' ? '3' : '1 640:2 960:3'"
              responsive="self"
              :x-gap="24"
              ><NFormItemGi :label="uiText('ui.dataset_editor_a3ccf702')"
                ><SourcePicker
                  :value="draft.definition.sourceId"
                  :disabled="busy"
                  :label="uiText('ui.dataset_editor_a3ccf702')"
                  @update:value="selectSource" /></NFormItemGi
              ><NFormItemGi
                v-if="draft.definition.mode === 'visual'"
                :label="uiText('ui.dataset_editor_30801f39')"
                ><NSelect
                  :value="draft.definition.objectId || null"
                  v-select-trigger-name="uiText('ui.dataset_editor_30801f39')"
                  :loading="objects.isLoading.value"
                  :disabled="busy"
                  :options="objects.data.value?.map((o) => ({ label: o.name, value: o.id }))"
                  @update:value="selectObject" /></NFormItemGi
              ><NFormItemGi :label="t('datasets.definitionMode')"
                ><NSelect
                  :value="draft.definition.mode"
                  :disabled="busy"
                  v-select-trigger-name="t('datasets.definitionMode')"
                  :options="[
                    { label: t('datasets.tableMode'), value: 'visual' },
                    { label: t('datasets.sqlMode'), value: 'sql' },
                  ]"
                  @update:value="selectDefinitionMode" /></NFormItemGi
              ><NFormItemGi :label="t('datasets.deliveryMode')"
                ><NSelect
                  v-model:value="draft.definition.deliveryMode"
                  :disabled="busy || (query.data.value?.publishedVersion ?? 0) > 0"
                  v-select-trigger-name="t('datasets.deliveryMode')"
                  :options="[
                    { label: t('datasets.directMode'), value: 'direct' },
                    { label: t('datasets.warehouseMode'), value: 'warehouse' },
                  ]" /></NFormItemGi></NGrid
            ><DatasetGraph
              v-if="draft.definition.mode === 'visual'"
              :readonly="busy"
              v-model:nodes="draft.definition.nodes"
              v-model:edges="draft.definition.edges"
            /><DatasetSqlWorkspace
              v-else
              v-model="draft.definition.sql"
              :pending="busy"
              :disabled="!canReadSensitive || !previewReady || save.isPending.value"
              :result="preview.data.value"
              :failed="preview.failed.value"
              :schema-current="preview.sqlSchemaCurrent.value"
              :schema-changes="preview.schemaChanges.value"
              @run="showPreview"
            >
              <template #reference>
                <AsyncState
                  :loading="objects.isLoading.value"
                  :error="objects.error.value"
                  @retry="objects.refetch()"
                >
                  <div class="sql-table-reference">
                    <SourceObjectList
                      :objects="objects.data.value ?? []"
                      :object-id="referenceObject?.id ?? ''"
                      @select="referenceId = $event"
                    />
                  </div>
                  <section class="sql-field-reference" :aria-label="t('sources.fields')">
                    <header v-if="referenceObject">
                      <strong>{{ referenceObject.name }}</strong
                      ><CopyButton :value="referenceObject.name" />
                    </header>
                    <p>{{ t('datasets.referenceHint') }}</p>
                    <ul>
                      <li
                        v-for="field in referenceObject?.fields ?? []"
                        :key="field.name"
                        :title="field.description"
                      >
                        <div>
                          <span>{{ field.name }}</span
                          ><CopyButton :value="field.name" />
                        </div>
                        <small>{{ field.type }}</small>
                      </li>
                    </ul>
                  </section>
                </AsyncState>
              </template>
            </DatasetSqlWorkspace></NTabPane
          ><NTabPane name="fields" :tab="uiText('ui.dataset_editor_e08a3aa8')"
            ><DatasetFields v-model="draft.definition.fields" :readonly="busy"
              ><template #mask-policy="{ field, disabled, update }">
                <GovernanceBindingSelect
                  kind="masking"
                  single
                  size="small"
                  :value="field.maskPolicyId ? [field.maskPolicyId] : []"
                  :label="t('datasets.fieldPolicy', { name: field.name })"
                  :disabled="disabled"
                  @update:value="update($event[0] ?? '')"
                /> </template></DatasetFields
            ><NFormItem :label="uiText('ui.dataset_editor_16fda324')" style="margin-top: 24px"
              ><NCheckboxGroup
                v-model:value="draft.definition.cleaning"
                :aria-label="uiText('ui.dataset_editor_16fda324')"
                ><NCheckbox value="trim">{{ uiText('ui.dataset_editor_d9f06fea') }}</NCheckbox>
              </NCheckboxGroup></NFormItem
            ></NTabPane
          ><NTabPane name="governance" :tab="uiText('ui.dataset_editor_9b99d4d0')"
            ><NFormItem :label="uiText('ui.dataset_editor_e974beee')"
              ><GovernanceBindingSelect
                kind="quality"
                v-model:value="draft.definition.qualityRuleIds"
                :label="uiText('ui.dataset_editor_e974beee')"
                :disabled="busy" /></NFormItem
            ><NFormItem :label="uiText('ui.dataset_editor_3792a310')"
              ><GovernanceBindingSelect
                kind="masking"
                v-model:value="draft.definition.maskPolicyIds"
                :label="uiText('ui.dataset_editor_3792a310')"
                :disabled="busy" /></NFormItem
            ><NAlert type="info">{{ uiText('ui.dataset_editor_0f9ea115') }}</NAlert></NTabPane
          ><NTabPane name="schedule" :tab="uiText('ui.dataset_editor_36019dc2')"
            ><NAlert v-if="draft.definition.deliveryMode === 'direct'" type="info">{{
              t('datasets.directHelp')
            }}</NAlert>
            <template v-else>
              <NAlert type="info">{{ t('datasets.scheduleUnsupported') }}</NAlert>
            </template></NTabPane
          ><NTabPane name="output" :tab="uiText('ui.dataset_editor_120a7b3d')"
            ><NAlert v-if="draft.definition.deliveryMode === 'direct'" type="info">{{
              t('datasets.directHelp')
            }}</NAlert>
            <template v-else>
              <NFormItem :label="t('warehouse.subjectDomain')"
                ><NInput
                  v-model:value="draft.definition.output.subjectDomain"
                  :maxlength="60"
                  :input-props="{ 'aria-label': t('warehouse.subjectDomain') }"
                  :placeholder="t('warehouse.domainHint')" /></NFormItem
              ><NGrid cols="1 640:2" responsive="self" :x-gap="24"
                ><NFormItemGi :label="uiText('ui.dataset_editor_2bee776c')"
                  ><NSelect
                    v-model:value="draft.definition.output.layer"
                    v-select-trigger-name="uiText('ui.dataset_editor_2bee776c')"
                    :options="
                      ['ODS', 'DWD', 'DWS', 'ADS'].map((value) => ({ label: value, value }))
                    " /></NFormItemGi
                ><NFormItemGi :label="uiText('ui.dataset_editor_442be9c4')"
                  ><NInput
                    v-model:value="draft.definition.output.table"
                    :disabled="(query.data.value?.publishedVersion ?? 0) > 0"
                    :input-props="{ 'aria-label': uiText('ui.dataset_editor_442be9c4') }"
                    placeholder="dwd_orders" /></NFormItemGi
                ><NFormItemGi :label="uiText('ui.dataset_editor_167a31ec')"
                  ><NSelect
                    v-model:value="draft.definition.output.writeMode"
                    v-select-trigger-name="uiText('ui.dataset_editor_167a31ec')"
                    :options="[
                      { label: uiText('ui.dataset_editor_855241c2'), value: 'replace' },
                    ]" /></NFormItemGi
                ><NFormItemGi :label="uiText('ui.dataset_editor_fd37952d')"
                  ><NSelect
                    v-model:value="draft.definition.output.keys"
                    v-select-trigger-name="uiText('ui.dataset_editor_fd37952d')"
                    multiple
                    clearable
                    :options="
                      draft.definition.fields
                        .filter((f) => f.output)
                        .map((f) => ({ label: f.target, value: f.target }))
                    " /></NFormItemGi
              ></NGrid>
              <DatasetOutputSummary :output="draft.definition.output" /> </template></NTabPane
          ><NTabPane
            v-if="draft.definition.mode === 'visual'"
            name="preview"
            :tab="uiText('ui.dataset_editor_de61aa8e')"
            ><AsyncState
              :loading="preview.isPending.value"
              :error="preview.failed.value"
              :empty="!preview.data.value"
              @retry="showPreview"
              ><NAlert type="info" class="mb">{{ preview.data.value?.notes.join('；') }}</NAlert
              ><NDataTable
                v-if="preview.data.value?.qualityResults?.length"
                :data="preview.data.value.qualityResults"
                :columns="[
                  { title: t('datasets.qualityResults'), key: 'ruleId' },
                  { title: t('status'), key: 'result' },
                  { title: t('datasets.passRate'), key: 'passRate' },
                  { title: t('description'), key: 'message' },
                ]"
                class="mb"
                :bordered="false" />
              <DataPreview
                :rows="preview.data.value?.rows ?? []"
                :columns="
                  preview.data.value?.fields.map((field) => field.target) ?? []
                " /></AsyncState></NTabPane></NTabs></NForm></NCard
  ></AsyncState>
</template>

<style scoped>
.dataset-editor-header {
  margin-bottom: 16px;
}
.basic-settings {
  margin-bottom: 12px;
}
.dataset-editor-card :deep(.n-form-item) {
  --n-label-height: 26px;
}
.sql-table-reference {
  flex: 1;
  min-height: 150px;
  overflow: hidden;
}
.sql-field-reference {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.sql-field-reference header,
.sql-field-reference li > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sql-field-reference header strong,
.sql-field-reference li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sql-field-reference p,
.sql-field-reference small {
  color: var(--textSecondary);
  font-size: 12px;
}
.sql-field-reference ul {
  flex: 1;
  overflow: auto;
  min-height: 0;
  list-style: none;
  padding: 0;
  margin: 0;
}
.sql-field-reference li {
  padding: 4px 0;
}
</style>
