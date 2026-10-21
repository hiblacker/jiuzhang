<script setup lang="ts">
import { vAccessibleTabs } from '@/shared/ui/accessible-tabs'
import { useRouteTab } from '@/shared/composables/use-route-tab'
import { ResponsiveDescriptions } from '@/shared/ui/responsive-descriptions'
import { DataPreview } from '@/shared/ui/data-preview'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
const canReadSensitive = useCan('readSensitive')
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NButton,
  NAlert,
  NTag,
  NTabs,
  NTabPane,
  NDescriptions,
  NDescriptionsItem,
  NDataTable,
} from 'naive-ui'
import {
  useDatasetEditor,
  useDatasetVersions,
  useDatasetActions,
  useDatasetPreview,
  DatasetOutputSummary,
  DatasetProcessingSettings,
  DatasetPreviewPanel,
} from '@/modules/datasets'
import { GovernanceBindingSelect } from '@/modules/governance'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { RunHistory, RunTrigger } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useCan } from '@/shared/security/permissions'
const route = useRoute(),
  router = useRouter(),
  { t } = useI18n(),
  id = computed(() => String(route.params.id))
const { query, draft, dirty, save, preview: processing, reset } = useDatasetEditor(id)
const editing = ref(false)
const busy = computed(() => save.isPending.value || processing.isPending.value)
const versions = useDatasetVersions(id),
  actions = useDatasetActions(),
  confirm = ref(false),
  readonly = computed(() => !canWrite.value)
const tab = useRouteTab(
  ['overview', 'preview', 'fields', 'rules', 'schedule', 'versions', 'runs'],
  'overview',
)
const preview = useDatasetPreview(
  id,
  () => tab.value === 'preview',
  () =>
    Boolean(
      query.data.value?.definition.deliveryMode === 'direct' && query.data.value?.publishedVersion,
    ),
)
const editGuard = useEditGuard(() => editing.value && dirty.value, busy)
function editProcessing() {
  if (readonly.value || busy.value) return
  tab.value = 'rules'
  editing.value = true
}
function cancelProcessing() {
  if (!editGuard.canLeave()) return
  reset()
  editing.value = false
}
async function saveProcessing() {
  if (readonly.value || busy.value) return
  try {
    await save.mutateAsync()
    editing.value = false
  } catch {}
}
function requestPublish() {
  if (readonly.value || editing.value || !query.data.value || actions.publish.isPending.value)
    return
  actions.publish.reset()
  confirm.value = true
}
async function publish() {
  if (readonly.value || !query.data.value || actions.publish.isPending.value) return
  try {
    await actions.publish.mutateAsync(id.value)
    confirm.value = false
  } catch {}
}
</script>
<template>
  <PageHeader
    :title="query.data.value?.name ?? uiText('ui.dataset_detail_e5d9dcd7')"
    :description="query.data.value?.description"
    ><NButton :disabled="readonly" @click="router.push('/datasets/' + id + '/edit')">{{
      uiText('ui.dataset_detail_13bd30e1')
    }}</NButton
    ><NButton :disabled="readonly || !query.data.value || editing" @click="editProcessing">{{
      t('datasets.editor.configureProcessing')
    }}</NButton
    ><NButton
      :disabled="readonly || !query.data.value || editing"
      type="primary"
      @click="requestPublish"
      >{{ uiText('ui.dataset_detail_c789c17a') }}</NButton
    ><RunTrigger
      v-if="query.data.value?.definition.deliveryMode !== 'direct'"
      :dataset-id="id"
      :disabled="!query.data.value?.publishedVersion"
      @started="router.push('/runs/' + $event)" /></PageHeader
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><NCard :bordered="false"
      ><NTabs
        v-accessible-tabs="uiText('ui.dataset_detail_e5d9dcd7')"
        :value="tab"
        @update:value="tab = $event"
        ><NTabPane name="overview" :tab="uiText('ui.dataset_detail_5060421d')"
          ><ResponsiveDescriptions :max-columns="2" bordered
            ><NDescriptionsItem label="ID">{{ id }} <CopyButton :value="id" /></NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_62e951a6')"
              ><NTag :bordered="false">{{
                query.data.value?.status === 'published'
                  ? uiText('ui.dataset_detail_176a2eb4')
                  : uiText('ui.dataset_detail_0f436818')
              }}</NTag></NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_c789c17a')"
              >v{{ query.data.value?.publishedVersion }}</NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_c63f79e6')"
              ><NButton
                text
                type="primary"
                @click="router.push('/sources/' + query.data.value?.definition.sourceId)"
                >{{ query.data.value?.definition.sourceId }}</NButton
              ></NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_442be9c4')">{{
              query.data.value?.definition.deliveryMode === 'direct'
                ? t('datasets.directMode')
                : query.data.value?.definition.output.table
            }}</NDescriptionsItem></ResponsiveDescriptions
          ><DatasetOutputSummary
            v-if="query.data.value && query.data.value.definition.deliveryMode !== 'direct'"
            class="mt"
            :output="query.data.value.definition.output"
          />
          <NAlert type="info" style="margin-top: 24px">{{
            query.data.value?.definition.deliveryMode === 'direct'
              ? t('datasets.directHelp')
              : uiText('ui.dataset_detail_ea6f74c7')
          }}</NAlert></NTabPane
        ><NTabPane name="preview" :tab="t('datasets.preview')">
          <AsyncState
            :loading="preview.isLoading.value"
            :error="preview.error.value"
            :empty="preview.data.value?.rows.length === 0"
            @retry="preview.refetch()"
          >
            <NAlert type="info" class="mb">{{ preview.data.value?.notes.join('；') }}</NAlert>
            <NDataTable
              v-if="preview.data.value?.qualityResults?.length"
              :data="preview.data.value.qualityResults"
              :columns="[
                { title: t('datasets.qualityResults'), key: 'ruleId' },
                { title: t('status'), key: 'result' },
                { title: t('datasets.passRate'), key: 'passRate' },
                { title: t('description'), key: 'message' },
              ]"
              class="mb"
              :bordered="false"
            />
            <DataPreview
              :rows="preview.data.value?.rows ?? []"
              :columns="preview.data.value?.fields.map((field) => field.target) ?? []"
            />
          </AsyncState> </NTabPane
        ><NTabPane name="fields" :tab="uiText('ui.dataset_detail_77a49f2c')"
          ><DataPreview
            :rows="query.data.value?.definition.fields.map((field) => ({ ...field })) ?? []"
            :columns="[
              { title: uiText('ui.dataset_detail_8e321432'), key: 'name' },
              { title: uiText('ui.dataset_detail_adf908d5'), key: 'target' },
              { title: uiText('ui.dataset_detail_e4e46c72'), key: 'type' },
              { title: uiText('ui.dataset_detail_26670dda'), key: 'description' },
            ]" /></NTabPane
        ><NTabPane name="rules" :tab="t('datasets.editor.process')">
          <template v-if="editing">
            <div class="processing-actions">
              <span>{{ t('datasets.editor.processHint') }}</span>
              <NButton :disabled="busy" @click="cancelProcessing">{{ t('cancel') }}</NButton>
              <NButton
                :disabled="
                  !canReadSensitive ||
                  busy ||
                  !draft.definition.fields.some((field) => field.output)
                "
                :loading="processing.isPending.value"
                @click="processing.run()"
                >{{ t('datasets.editor.previewProcessing') }}</NButton
              >
              <NButton
                type="primary"
                :disabled="busy || !dirty"
                :loading="save.isPending.value"
                @click="saveProcessing"
                >{{ t('datasets.editor.saveProcessing') }}</NButton
              >
            </div>
            <DatasetProcessingSettings v-model="draft.definition" :disabled="busy">
              <template #mask-policy="{ field, disabled, update }">
                <GovernanceBindingSelect
                  kind="masking"
                  single
                  size="small"
                  :value="field.maskPolicyId ? [field.maskPolicyId] : []"
                  :label="t('datasets.fieldPolicy', { name: field.name })"
                  :disabled="disabled"
                  @update:value="update($event[0] ?? '')"
                />
              </template>
              <template #quality
                ><GovernanceBindingSelect
                  kind="quality"
                  v-model:value="draft.definition.qualityRuleIds"
                  :label="t('ui.dataset_editor_e974beee')"
                  :disabled="busy"
              /></template>
              <template #masking
                ><GovernanceBindingSelect
                  kind="masking"
                  v-model:value="draft.definition.maskPolicyIds"
                  :label="t('ui.dataset_editor_3792a310')"
                  :disabled="busy"
              /></template>
            </DatasetProcessingSettings>
            <div class="processing-preview">
              <DatasetPreviewPanel
                kind="processing"
                :result="processing.data.value"
                :pending="processing.isPending.value"
                :failed="processing.failed.value"
              />
            </div>
          </template>
          <NDescriptions v-else :column="1" bordered
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_cd56476f')">{{
              query.data.value?.definition.cleaning.join('、') || '—'
            }}</NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_e974beee')"
              ><NButton
                v-for="rule in query.data.value?.definition.qualityRuleIds"
                :key="rule"
                text
                type="primary"
                @click="router.push('/governance/quality/' + rule)"
                >{{ rule }}</NButton
              ></NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_0549993d')"
              ><NButton
                v-for="rule in query.data.value?.definition.maskPolicyIds"
                :key="rule"
                text
                type="primary"
                @click="router.push('/governance/masking/' + rule)"
                >{{ rule }}</NButton
              ></NDescriptionsItem
            ></NDescriptions
          ></NTabPane
        ><NTabPane name="schedule" :tab="uiText('ui.dataset_detail_36019dc2')"
          ><NAlert type="info">{{
            query.data.value?.definition.deliveryMode === 'direct'
              ? t('datasets.directHelp')
              : t('datasets.scheduleUnsupported')
          }}</NAlert></NTabPane
        ><NTabPane name="versions" :tab="uiText('ui.dataset_detail_989d1aff')"
          ><AsyncState
            :loading="versions.isLoading.value"
            :error="versions.error.value"
            :empty="versions.data.value?.length === 0"
            @retry="versions.refetch()"
            ><div v-for="version in versions.data.value" :key="version.id" class="version-row">
              <div>
                <strong>v{{ version.version }}</strong>
                <p>{{ version.createdAt }}</p>
              </div>
              <NButton @click="router.push('/datasets/' + id + '/versions/' + version.version)">{{
                uiText('ui.dataset_detail_31140423')
              }}</NButton>
            </div></AsyncState
          ></NTabPane
        ><NTabPane name="runs" :tab="uiText('ui.dataset_detail_0c3acd44')"
          ><RunHistory
            :scope="{ datasetId: id }"
            @select="router.push('/runs/' + $event)" /></NTabPane></NTabs></NCard></AsyncState
  ><ConfirmDialog
    :show="confirm"
    :title="uiText('ui.dataset_detail_bbbe36d4')"
    :description="
      uiText('ui.dataset_detail_ef13ebf7') +
      ((query.data.value?.publishedVersion ?? 0) + 1) +
      (query.data.value?.definition.deliveryMode === 'direct'
        ? t('datasets.directPublishedOutput')
        : t('datasets.realOutput'))
    "
    :pending="actions.publish.isPending.value"
    :confirm-text="uiText('ui.dataset_detail_221f71a4')"
    :destructive="false"
    :disabled="readonly || !query.data.value"
    @confirm="publish"
    @cancel="confirm = false"
  />
</template>
<style scoped>
.processing-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}
.processing-actions > span {
  flex: 1;
  color: var(--textSecondary);
}
.processing-preview {
  height: 360px;
  margin-top: 24px;
}
.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.version-row p {
  color: var(--textSecondary);
  font-size: 12px;
}
</style>
