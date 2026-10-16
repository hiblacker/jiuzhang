<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
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
  NModal,
  NSpace,
  NEmpty,
} from 'naive-ui'
import {
  useDataset,
  useDatasetVersions,
  useDatasetActions,
  useDatasetPreview,
  useFolders,
  folderPath,
} from '@/modules/datasets'
import { useRuns, RunTrigger } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { errorKey } from '@/shared/api/error-message'
import { useCan } from '@/shared/security/permissions'
const route = useRoute(),
  router = useRouter(),
  { t } = useI18n(),
  id = computed(() => String(route.params.id))
const query = useDataset(id),
  folders = useFolders(),
  versions = useDatasetVersions(id),
  runs = useRuns({ pageSize: '100' }),
  actions = useDatasetActions(),
  confirm = ref(false),
  readonly = computed(() => !canWrite.value)
const tab = computed(() => String(route.query.tab ?? 'overview'))
const preview = useDatasetPreview(id, () => tab.value === 'preview')
const relatedRuns = computed(
  () => runs.data.value?.data.filter((r) => r.datasetId === id.value) ?? [],
)
async function publish() {
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
    ><NButton :disabled="readonly" type="primary" @click="confirm = true">{{
      uiText('ui.dataset_detail_c789c17a')
    }}</NButton
    ><RunTrigger
      :dataset-id="id"
      :disabled="!query.data.value?.publishedVersion"
      @started="router.push('/runs/' + $event)" /></PageHeader
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><NCard :bordered="false"
      ><NTabs :value="tab" @update:value="router.replace({ query: { tab: $event } })"
        ><NTabPane name="overview" :tab="uiText('ui.dataset_detail_5060421d')"
          ><NDescriptions :column="2" label-placement="left" bordered
            ><NDescriptionsItem :label="t('folders.folder')">{{
              folderPath(folders.data.value ?? [], query.data.value?.folderId) ||
              t('folders.unfiled')
            }}</NDescriptionsItem
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
                @click="
                  router.push(
                    query.data.value?.definition.upstreamDatasetId
                      ? '/datasets/' + query.data.value.definition.upstreamDatasetId
                      : '/sources/' + query.data.value?.definition.sourceId,
                  )
                "
                >{{
                  query.data.value?.definition.upstreamDatasetId ||
                  query.data.value?.definition.sourceId
                }}</NButton
              ></NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_442be9c4')">{{
              query.data.value?.definition.output.table
            }}</NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_dd32f296')">{{
              query.data.value?.definition.output.writeMode
            }}</NDescriptionsItem></NDescriptions
          ><NAlert type="info" style="margin-top: 24px">{{
            uiText('ui.dataset_detail_ea6f74c7')
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
            <NDataTable
              :data="preview.data.value?.rows ?? []"
              :columns="
                preview.data.value?.fields.map((field) => ({
                  title: field.target,
                  key: field.target,
                })) ?? []
              "
              :bordered="false"
            />
          </AsyncState> </NTabPane
        ><NTabPane name="fields" :tab="uiText('ui.dataset_detail_77a49f2c')"
          ><NDataTable
            :data="query.data.value?.definition.fields ?? []"
            :columns="[
              { title: uiText('ui.dataset_detail_8e321432'), key: 'name' },
              { title: uiText('ui.dataset_detail_adf908d5'), key: 'target' },
              { title: uiText('ui.dataset_detail_e4e46c72'), key: 'type' },
              { title: uiText('ui.dataset_detail_26670dda'), key: 'description' },
            ]"
            :bordered="false" /></NTabPane
        ><NTabPane name="rules" :tab="uiText('ui.dataset_detail_9b99d4d0')"
          ><NDescriptions :column="1" bordered
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
          ><NDescriptions :column="2"
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_af908096')">{{
              query.data.value?.definition.schedule.mode
            }}</NDescriptionsItem
            ><NDescriptionsItem label="Cron">{{
              query.data.value?.definition.schedule.cron
            }}</NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_fb2a23dc')">{{
              query.data.value?.definition.schedule.timezone
            }}</NDescriptionsItem
            ><NDescriptionsItem :label="uiText('ui.dataset_detail_e2d53a6d')">{{
              query.data.value?.definition.schedule.retries
            }}</NDescriptionsItem></NDescriptions
          ><NButton @click="router.push('/tasks')">{{
            uiText('ui.dataset_detail_d1d5bfef')
          }}</NButton></NTabPane
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
          ><NEmpty v-if="!relatedRuns.length" :description="uiText('ui.dataset_detail_cdff1346')" />
          <div v-for="run in relatedRuns" :key="run.id" class="version-row">
            <NButton text type="primary" @click="router.push('/runs/' + run.id)">{{
              run.id
            }}</NButton
            ><span>{{ t('states.' + run.status) }} · v{{ run.datasetVersion }}</span>
          </div></NTabPane
        ><NTabPane name="lineage" :tab="uiText('ui.dataset_detail_34c5a283')"
          ><NButton
            type="primary"
            secondary
            @click="
              router.push({ path: '/governance/lineage', query: { resource: 'dataset-' + id } })
            "
            >{{ uiText('ui.dataset_detail_119a12a0') }}</NButton
          ></NTabPane
        ></NTabs
      ></NCard
    ></AsyncState
  ><NModal
    :show="confirm"
    preset="card"
    :title="uiText('ui.dataset_detail_bbbe36d4')"
    style="width: 480px"
    :closable="!actions.publish.isPending.value"
    :mask-closable="false"
    @close="confirm = false"
    ><p>
      {{ uiText('ui.dataset_detail_ef13ebf7') }}{{ (query.data.value?.publishedVersion ?? 0) + 1
      }}{{ uiText('ui.dataset_detail_ef711d29') }}
    </p>
    <NAlert v-if="actions.publish.error.value" type="error">{{
      t(errorKey(actions.publish.error.value))
    }}</NAlert
    ><template #footer
      ><NSpace justify="end"
        ><NButton :disabled="actions.publish.isPending.value" @click="confirm = false">{{
          uiText('ui.dataset_detail_4d0b4688')
        }}</NButton
        ><NButton type="primary" :loading="actions.publish.isPending.value" @click="publish">{{
          uiText('ui.dataset_detail_221f71a4')
        }}</NButton></NSpace
      ></template
    ></NModal
  >
</template>
<style scoped>
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
