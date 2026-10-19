<script setup lang="ts">
import { TagEditor } from '@/shared/ui/tag-editor'
import { vAccessibleTabs } from '@/shared/ui/accessible-tabs'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useRouteTab } from '@/shared/composables/use-route-tab'
import { DataPreview } from '@/shared/ui/data-preview'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, ref, watch, defineAsyncComponent } from 'vue'
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
  NGrid,
  NFormItemGi,
  type FormInst,
} from 'naive-ui'
import {
  useDatasetEditor,
  sourceFieldType,
  useDataset,
  useDatasetVersion,
  DatasetFields,
  DatasetGraph,
  DatasetFolderSelect,
  DatasetOutputSummary,
  UpstreamDatasetSelect,
} from '@/modules/datasets'
import { SourcePicker, useSourceObjects } from '@/modules/sources'
import { GovernanceBindingSelect } from '@/modules/governance'
import { ScheduleForm } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { errorKey } from '@/shared/api/error-message'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
const SqlEditor = defineAsyncComponent(() => import('@/shared/editors/SqlEditor.vue'))
const route = useRoute(),
  router = useRouter(),
  { t } = useI18n()
const real = import.meta.env.VITE_API_MODE === 'real'
const id = computed(() => String(route.params.id ?? ''))
const { query, draft, dirty, save, preview } = useDatasetEditor(id)
const objects = useSourceObjects(() => draft.value.definition.sourceId)
const upstream = useDataset(() => draft.value.definition.upstreamDatasetId)
const upstreamVersion = useDatasetVersion(
  () => draft.value.definition.upstreamDatasetId,
  () => (upstream.data.value?.publishedVersion ? String(upstream.data.value.publishedVersion) : ''),
)
const selectedUpstream = ref('')
watch([selectedUpstream, () => upstreamVersion.data.value], ([selected, version]) => {
  if (
    version &&
    selected === version.datasetId &&
    selected === draft.value.definition.upstreamDatasetId
  ) {
    draft.value.definition.fields = version.definition.fields
      .filter((field) => field.output)
      .map((field) => ({ ...field, name: field.target }))
    selectedUpstream.value = ''
  }
})
function selectUpstream(value: string | null) {
  draft.value.definition.upstreamDatasetId = value ?? ''
  selectedUpstream.value = value ?? ''
  if (value) {
    draft.value.definition.sourceId = ''
    draft.value.definition.objectId = ''
    draft.value.definition.fields = []
  }
}
const form = ref<FormInst>(),
  tab = useRouteTab(['input', 'fields', 'governance', 'schedule', 'output', 'preview'], 'input')
if (!id.value) {
  draft.value.folderId = typeof route.query.folderId === 'string' ? route.query.folderId : null
  draft.value.definition.sourceId = String(route.query.sourceId ?? '')
  draft.value.definition.objectId = String(route.query.objectId ?? '')
}
watch(
  () => objects.data.value,
  (items) => {
    const object = items?.find((x) => x.id === draft.value.definition.objectId)
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
  selectedUpstream.value = ''
  draft.value.definition.upstreamDatasetId = ''
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
async function submit() {
  if (save.isPending.value || selectedUpstream.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (save.isPending.value || selectedUpstream.value) return
  try {
    const d = await save.mutateAsync()
    await router.push('/datasets/' + d.id)
  } catch {}
}
async function showPreview() {
  try {
    await preview.mutateAsync()
    tab.value = 'preview'
  } catch {
    tab.value = 'preview'
  }
}
useEditGuard(dirty, save.isPending)
</script>
<template>
  <PageHeader
    :title="id ? uiText('ui.dataset_editor_3dabd36c') : uiText('ui.dataset_editor_e78bd5fa')"
    :description="uiText('ui.dataset_editor_d380f2ee')"
    ><NButton
      :disabled="save.isPending.value"
      @click="router.push(id ? '/datasets/' + id : '/datasets')"
      >{{ uiText('ui.dataset_editor_4d0b4688') }}</NButton
    ><NButton :loading="preview.isPending.value" @click="showPreview">{{
      uiText('ui.dataset_editor_350d00d1')
    }}</NButton
    ><NButton
      type="primary"
      :loading="save.isPending.value"
      :disabled="!!selectedUpstream"
      @click="submit"
      >{{ uiText('ui.dataset_editor_4cd30ef9') }}</NButton
    ></PageHeader
  ><AsyncState
    :loading="!!id && query.isLoading.value"
    :error="query.error.value"
    @retry="query.refetch()"
    ><NAlert v-if="real" type="info" class="mb">{{ t('datasets.realScope') }}</NAlert>
    <NAlert v-if="save.error.value" type="error" class="mb">{{
      t(errorKey(save.error.value))
    }}</NAlert
    ><NCard :bordered="false"
      ><NForm
        ref="form"
        :model="draft"
        :rules="{
          name: { required: true, message: uiText('ui.dataset_editor_505e9598'), trigger: 'blur' },
        }"
        label-placement="top"
        ><NGrid cols="1 640:2 960:3" responsive="self" :x-gap="24"
          ><NFormItemGi :label="uiText('ui.dataset_editor_5aa625bf')" path="name"
            ><NInput
              v-model:value="draft.name"
              :input-props="{ 'aria-label': uiText('ui.dataset_editor_5aa625bf') }"
              :placeholder="uiText('ui.dataset_editor_5aa625bf')" /></NFormItemGi
          ><NFormItemGi :label="uiText('ui.dataset_editor_974d383f')"
            ><NInput
              v-model:value="draft.owner"
              :input-props="{ 'aria-label': uiText('ui.dataset_editor_974d383f') }" /></NFormItemGi
          ><NFormItemGi :label="uiText('ui.dataset_editor_ae0a7afe')"
            ><TagEditor
              v-model="draft.tags"
              :disabled="save.isPending.value" /></NFormItemGi></NGrid
        ><NFormItem v-if="!real" :label="t('folders.folder')"
          ><DatasetFolderSelect
            v-model="draft.folderId"
            :label="t('folders.folder')"
            :empty-label="t('folders.unfiled')" /></NFormItem
        ><NFormItem :label="uiText('ui.dataset_editor_26670dda')"
          ><NInput
            v-model:value="draft.description"
            :input-props="{ 'aria-label': uiText('ui.dataset_editor_26670dda') }" /></NFormItem
        ><NTabs
          v-accessible-tabs="uiText('ui.dataset_editor_3dabd36c')"
          v-model:value="tab"
          type="line"
          animated
          ><NTabPane name="input" :tab="uiText('ui.dataset_editor_f0f6fbb8')">
            <NFormItem v-if="!real" :label="t('datasets.upstream')">
              <UpstreamDatasetSelect
                :value="draft.definition.upstreamDatasetId"
                :excluded-id="id"
                :disabled="save.isPending.value"
                @update:value="selectUpstream"
              />
            </NFormItem>
            <NAlert v-if="draft.definition.upstreamDatasetId" type="info" class="mb">{{
              t('datasets.upstreamHint')
            }}</NAlert>
            <NAlert
              v-if="selectedUpstream"
              :type="upstreamVersion.error.value ? 'error' : 'info'"
              class="mb"
            >
              <p>{{ t('datasets.upstreamSchemaPending') }}</p>
              <template v-if="upstreamVersion.error.value">
                <p>{{ t(errorKey(upstreamVersion.error.value)) }}</p>
                <NButton
                  :loading="upstreamVersion.isFetching.value"
                  @click="upstreamVersion.refetch()"
                  >{{ t('retry') }}</NButton
                >
              </template>
            </NAlert>
            <NGrid cols="1 640:2 960:3" responsive="self" :x-gap="24"
              ><NFormItemGi :label="uiText('ui.dataset_editor_a3ccf702')"
                ><SourcePicker
                  :value="draft.definition.sourceId"
                  :label="uiText('ui.dataset_editor_a3ccf702')"
                  @update:value="selectSource" /></NFormItemGi
              ><NFormItemGi :label="uiText('ui.dataset_editor_30801f39')"
                ><NSelect
                  :value="draft.definition.objectId || null"
                  v-select-trigger-name="uiText('ui.dataset_editor_30801f39')"
                  :loading="objects.isLoading.value"
                  :options="objects.data.value?.map((o) => ({ label: o.name, value: o.id }))"
                  @update:value="selectObject" /></NFormItemGi
              ><NFormItemGi :label="uiText('ui.dataset_editor_dbab9d39')"
                ><NSelect
                  v-model:value="draft.definition.mode"
                  v-select-trigger-name="uiText('ui.dataset_editor_dbab9d39')"
                  :options="[
                    { label: uiText('ui.dataset_editor_3ada073b'), value: 'visual' },
                    { label: uiText('ui.dataset_editor_59d93d23'), value: 'sql', disabled: real },
                  ]" /></NFormItemGi></NGrid
            ><DatasetGraph
              v-if="draft.definition.mode === 'visual'"
              v-model:nodes="draft.definition.nodes"
              v-model:edges="draft.definition.edges" /><template v-else
              ><NAlert type="info" class="mb">{{ uiText('ui.dataset_editor_5364df03') }}</NAlert
              ><NSelect
                v-model:value="draft.definition.sql"
                v-select-trigger-name="t('datasets.sqlPreset')"
                :options="
                  [
                    'SELECT * FROM orders LIMIT 12',
                    'SELECT id, customer, amount FROM orders LIMIT 12',
                  ].map((value) => ({ value, label: value }))
                "
                class="mb" /><SqlEditor
                v-model="draft.definition.sql"
                :label="t('datasets.sqlEditor')" /></template></NTabPane
          ><NTabPane name="fields" :tab="uiText('ui.dataset_editor_e08a3aa8')"
            ><DatasetFields v-model="draft.definition.fields" :readonly="save.isPending.value"
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
                ><NCheckbox value="trim">{{ uiText('ui.dataset_editor_d9f06fea') }}</NCheckbox
                ><NCheckbox value="fill-null" :disabled="real">{{
                  uiText('ui.dataset_editor_6ec90bfe')
                }}</NCheckbox
                ><NCheckbox value="deduplicate" :disabled="real">{{
                  uiText('ui.dataset_editor_69d3566b')
                }}</NCheckbox></NCheckboxGroup
              ></NFormItem
            ></NTabPane
          ><NTabPane name="governance" :tab="uiText('ui.dataset_editor_9b99d4d0')"
            ><NFormItem :label="uiText('ui.dataset_editor_e974beee')"
              ><GovernanceBindingSelect
                kind="quality"
                v-model:value="draft.definition.qualityRuleIds"
                :label="uiText('ui.dataset_editor_e974beee')"
                :disabled="save.isPending.value" /></NFormItem
            ><NFormItem :label="uiText('ui.dataset_editor_3792a310')"
              ><GovernanceBindingSelect
                kind="masking"
                v-model:value="draft.definition.maskPolicyIds"
                :label="uiText('ui.dataset_editor_3792a310')"
                :disabled="save.isPending.value" /></NFormItem
            ><NAlert type="info">{{ uiText('ui.dataset_editor_0f9ea115') }}</NAlert></NTabPane
          ><NTabPane name="schedule" :tab="uiText('ui.dataset_editor_36019dc2')"
            ><NAlert v-if="real" type="info">{{ t('datasets.realScope') }}</NAlert>
            <ScheduleForm
              v-else
              v-model="draft.definition.schedule"
              path="definition.schedule"
              :excluded-dataset-id="id"
              :readonly="save.isPending.value" /></NTabPane
          ><NTabPane name="output" :tab="uiText('ui.dataset_editor_120a7b3d')"
            ><NFormItem :label="t('warehouse.subjectDomain')"
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
                  :disabled="real && !!id"
                  :input-props="{ 'aria-label': uiText('ui.dataset_editor_442be9c4') }"
                  placeholder="dwd_demo_orders" /></NFormItemGi
              ><NFormItemGi :label="uiText('ui.dataset_editor_167a31ec')"
                ><NSelect
                  v-model:value="draft.definition.output.writeMode"
                  v-select-trigger-name="uiText('ui.dataset_editor_167a31ec')"
                  :options="[
                    {
                      label: uiText('ui.dataset_editor_aec344de'),
                      value: 'append',
                      disabled: real,
                    },
                    {
                      label: uiText('ui.dataset_editor_b2a57ab0'),
                      value: 'upsert',
                      disabled: real,
                    },
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
            <DatasetOutputSummary :output="draft.definition.output" /> </NTabPane
          ><NTabPane name="preview" :tab="uiText('ui.dataset_editor_de61aa8e')"
            ><AsyncState
              :loading="preview.isPending.value"
              :error="preview.error.value"
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
