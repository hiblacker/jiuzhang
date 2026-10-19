<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NDescriptions,
  NDescriptionsItem,
  NAlert,
  NCollapse,
  NCollapseItem,
  NEmpty,
} from 'naive-ui'
import {
  useDatasetVersion,
  useDataset,
  useDatasetActions,
  compareVersionFields,
  DatasetOutputSummary,
} from '@/modules/datasets'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { ResponsiveDescriptions } from '@/shared/ui/responsive-descriptions'
import { DataPreview } from '@/shared/ui/data-preview'
import { useCan } from '@/shared/security/permissions'

const { t } = useI18n()
const canWrite = useCan('write')
const route = useRoute(),
  router = useRouter()
const id = computed(() => String(route.params.id))
const version = computed(() => String(route.params.version))
const query = useDatasetVersion(id, version),
  current = useDataset(id),
  actions = useDatasetActions()
const confirming = ref(false)
const sourceObjectId = computed(() =>
  typeof route.query.sourceObjectId === 'string' ? route.query.sourceObjectId : '',
)
const sourceField = computed(() => (typeof route.query.field === 'string' ? route.query.field : ''))
const snapshotColumns = computed(() => [
  { title: t('field'), key: 'name' },
  { title: t('dataType'), key: 'type' },
  {
    title: t('datasets.version.fields.nullable'),
    key: 'nullable',
  },
  {
    title: t('datasets.version.fields.sensitive'),
    key: 'sensitive',
  },
  { title: t('description'), key: 'description' },
])
const diff = computed(() =>
  compareVersionFields(
    query.data.value?.definition.fields ?? [],
    current.data.value?.definition.fields ?? [],
  ).map((row) => ({
    ...row,
    historical: row.before ? row.before.target + ' · ' + row.before.type : '—',
    draft: row.after ? row.after.target + ' · ' + row.after.type : '—',
    change: t('datasets.version.' + row.status),
    details: row.changes.map((key) => t('datasets.version.fields.' + key)).join('、') || '—',
  })),
)
async function refresh() {
  await Promise.all([query.refetch(), current.refetch()])
}
function requestRestore() {
  actions.restore.reset()
  confirming.value = true
}
async function restore() {
  if (actions.restore.isPending.value) return
  try {
    await actions.restore.mutateAsync({ id: id.value, version: version.value })
    confirming.value = false
    await router.push('/datasets/' + id.value + '/edit')
  } catch {
    /* The confirmation owns the error and retains the retry action. */
  }
}
</script>
<template>
  <PageHeader
    :title="(query.data.value?.name ?? t('ui.dataset_version_fc2b4735')) + ' · v' + version"
    :description="t('ui.dataset_version_e52ee919')"
  >
    <NButton @click="router.push('/datasets/' + id)">{{
      t('ui.dataset_version_da9af890')
    }}</NButton>
    <NButton
      type="primary"
      :disabled="!canWrite || !query.data.value || !current.data.value"
      @click="requestRestore"
    >
      {{ t('ui.dataset_version_f46bbaac') }}
    </NButton>
  </PageHeader>
  <AsyncState
    :loading="query.isLoading.value || current.isLoading.value"
    :error="query.error.value || current.error.value"
    @retry="refresh"
  >
    <NCard :bordered="false">
      <ResponsiveDescriptions :max-columns="2">
        <NDescriptionsItem :label="t('ui.dataset_version_b410c241')">{{
          query.data.value?.createdAt
        }}</NDescriptionsItem>
        <NDescriptionsItem :label="t('ui.dataset_version_442be9c4')">{{
          query.data.value?.definition.output.table
        }}</NDescriptionsItem>
      </ResponsiveDescriptions>
      <DatasetOutputSummary
        v-if="query.data.value"
        class="mt"
        :output="query.data.value.definition.output"
      />
    </NCard>
    <NCard :title="t('datasets.version.sourceSchemas')" :bordered="false" class="mt">
      <NAlert type="info" class="mb">{{ t('datasets.version.schemaBoundary') }}</NAlert>
      <NAlert
        v-if="query.data.value?.sourceSnapshotOrigin === 'migrated'"
        type="warning"
        class="mb"
        >{{ t('datasets.version.migratedWarning') }}</NAlert
      >
      <NDescriptions :column="1" class="mb">
        <NDescriptionsItem :label="t('datasets.version.captureOrigin')">{{
          query.data.value?.sourceSnapshotOrigin === 'migrated'
            ? t('datasets.version.migrated')
            : t('datasets.version.published')
        }}</NDescriptionsItem>
        <NDescriptionsItem :label="t('datasets.version.capturedAt')">{{
          query.data.value?.sourceSnapshotCapturedAt
        }}</NDescriptionsItem>
      </NDescriptions>
      <NButton
        v-if="query.data.value?.definition.upstreamDatasetId"
        text
        type="primary"
        class="mb"
        @click="
          router.push(
            '/datasets/' +
              query.data.value.definition.upstreamDatasetId +
              '/versions/' +
              query.data.value.upstreamVersion,
          )
        "
      >
        {{ t('datasets.version.upstreamVersion', { version: query.data.value.upstreamVersion }) }}
      </NButton>
      <NAlert
        v-if="
          sourceObjectId &&
          !query.data.value?.sourceSnapshots.some(
            (snapshot) => snapshot.object.id === sourceObjectId,
          )
        "
        type="warning"
        class="mb"
        >{{ t('resourceNotFound') }}</NAlert
      >
      <NCollapse
        :key="id + ':' + version + ':' + sourceObjectId"
        :default-expanded-names="sourceObjectId ? [sourceObjectId] : []"
      >
        <NCollapseItem
          v-for="snapshot in query.data.value?.sourceSnapshots ?? []"
          :key="snapshot.object.id"
          :name="snapshot.object.id"
          :title="snapshot.sourceName + ' / ' + snapshot.object.name"
        >
          <div class="query-toolbar">
            <span>{{ t('datasets.version.objectId') }}: {{ snapshot.object.id }}</span>
            <NButton
              text
              type="primary"
              @click="
                router.push(
                  '/sources/' + snapshot.object.sourceId + '?objectId=' + snapshot.object.id,
                )
              "
              >{{ t('datasets.version.currentSource') }}</NButton
            >
          </div>
          <NAlert
            v-if="sourceObjectId === snapshot.object.id && sourceField"
            type="info"
            class="mb"
          >
            {{ t('sources.selectedField', { field: sourceField }) }}
            <NButton
              text
              @click="router.replace({ query: { ...route.query, field: undefined } })"
              >{{ t('sources.allFields') }}</NButton
            >
          </NAlert>
          <DataPreview
            :columns="snapshotColumns"
            :rows="
              (sourceObjectId === snapshot.object.id && sourceField
                ? snapshot.object.fields.filter((field) => field.name === sourceField)
                : snapshot.object.fields
              ).map((field) => ({
                ...field,
                nullable: field.nullable ? t('datasets.version.yes') : t('datasets.version.no'),
                sensitive: field.sensitive ? t('datasets.version.yes') : t('datasets.version.no'),
              }))
            "
          />
        </NCollapseItem>
      </NCollapse>
      <NEmpty
        v-if="query.data.value?.sourceSnapshots.length === 0"
        :description="t('datasets.version.noDirectSource')"
      />
    </NCard>
    <NCard :bordered="false" class="mt">
      <NAlert type="info" class="mb">{{ t('datasets.version.direction') }}</NAlert>
      <DataPreview
        :rows="
          diff.map(({ name, historical, draft, change, details }) => ({
            name,
            historical,
            draft,
            change,
            details,
          }))
        "
        :columns="[
          { title: t('datasets.version.fields.name'), key: 'name' },
          { title: t('datasets.version.historical'), key: 'historical' },
          { title: t('datasets.version.current'), key: 'draft' },
          { title: t('ui.dataset_version_9318a258'), key: 'change' },
          { title: t('datasets.version.changedProperties'), key: 'details' },
        ]"
      />
      <NCollapse class="mt">
        <NCollapseItem name="definition" :title="t('datasets.version.definition')">
          <pre>{{ JSON.stringify(query.data.value?.definition, null, 2) }}</pre>
        </NCollapseItem>
      </NCollapse>
    </NCard>
  </AsyncState>
  <ConfirmDialog
    :show="confirming"
    :title="t('datasets.version.restoreTitle')"
    :description="t('datasets.version.restoreDescription', { version })"
    :confirm-text="t('datasets.version.restoreConfirm')"
    :destructive="false"
    :pending="actions.restore.isPending.value"
    @cancel="confirming = false"
    @confirm="restore"
  />
</template>
<style scoped>
.mt {
  margin-top: 24px;
}
pre {
  overflow: auto;
  background: var(--surface);
  padding: 20px;
  border-radius: 10px;
  font-size: 12px;
}
</style>
