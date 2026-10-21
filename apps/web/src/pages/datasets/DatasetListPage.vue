<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NCard,
  NDataTable,
  NEllipsis,
  NInput,
  NPagination,
  NSelect,
  NSpace,
  NTag,
  type DataTableColumns,
} from 'naive-ui'
import { Layers, Plus } from 'lucide-vue-next'
import { useDatasets, useDatasetActions } from '@/modules/datasets'
import { RunTrigger } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useListRoute } from '@/shared/composables/use-list-route'
import { useCan } from '@/shared/security/permissions'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import type { Model } from '@/shared/api/types'
import { useI18n as useUiI18n } from 'vue-i18n'

const { t: uiText } = useUiI18n()
const canWrite = useCan('write')
const { t } = useI18n()
const router = useRouter()
const { filters, update, bindPagination } = useListRoute()
const actions = useDatasetActions()
const params = computed(() =>
  Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
)
const query = useDatasets(params)
const deleteId = ref('')
const readonly = computed(() => !canWrite.value)

bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)

async function remove() {
  if (actions.remove.isPending.value) return
  try {
    await actions.remove.mutateAsync(deleteId.value)
    deleteId.value = ''
  } catch {}
}

const columns = computed<DataTableColumns<Model<'Dataset'>>>(() => [
  {
    title: uiText('ui.dataset_list_fc2b4735'),
    key: 'name',
    width: 260,
    render: (dataset) =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          class: 'resource-name',
          title: dataset.name,
          onClick: () => router.push('/datasets/' + dataset.id),
        },
        {
          icon: () => h(Layers, { size: 18 }),
          default: () => h('span', { class: 'resource-name__text' }, dataset.name),
        },
      ),
  },
  {
    title: uiText('ui.dataset_list_62e951a6'),
    key: 'status',
    width: 110,
    render: (dataset) =>
      h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type: dataset.status === 'published' ? 'success' : 'default',
        },
        () =>
          dataset.status === 'published'
            ? uiText('ui.dataset_list_176a2eb4')
            : uiText('ui.dataset_list_0f436818'),
      ),
  },
  {
    title: t('datasets.deliveryMode'),
    key: 'deliveryMode',
    width: 140,
    render: (dataset) =>
      h(NTag, { size: 'small', bordered: false }, () =>
        dataset.definition.deliveryMode === 'direct'
          ? t('datasets.directMode')
          : t('datasets.warehouseMode'),
      ),
  },
  {
    title: uiText('ui.dataset_list_c789c17a'),
    key: 'publishedVersion',
    width: 100,
    render: (dataset) => (dataset.publishedVersion ? 'v' + dataset.publishedVersion : '—'),
  },
  {
    title: uiText('ui.dataset_list_974d383f'),
    key: 'owner',
    width: 140,
    render: (dataset) =>
      h(
        NEllipsis,
        {
          tabindex: 0,
          tooltip: {
            trigger: 'focus',
            contentStyle: { maxWidth: 'min(480px, calc(100vw - 32px))', overflowWrap: 'anywhere' },
          },
        },
        {
          default: () => dataset.owner,
          tooltip: () => h('span', { role: 'tooltip' }, dataset.owner),
        },
      ),
  },
  {
    title: uiText('ui.dataset_list_f3ea6d34'),
    key: 'actions',
    width: 360,
    render: (dataset) =>
      h(NSpace, { align: 'center' }, () => [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            disabled: readonly.value,
            onClick: () => router.push('/datasets/' + dataset.id + '/edit'),
          },
          () => t('edit'),
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'error',
            disabled: readonly.value,
            onClick: () => {
              deleteId.value = dataset.id
              actions.remove.reset()
            },
          },
          () => t('delete'),
        ),
        ...(dataset.definition.deliveryMode === 'direct'
          ? []
          : [
              h(RunTrigger, {
                datasetId: dataset.id,
                disabled: !dataset.publishedVersion,
                onStarted: (id: string) => router.push('/runs/' + id),
              }),
            ]),
      ]),
  },
])
</script>

<template>
  <PageHeader
    :title="uiText('ui.dataset_list_fc2b4735')"
    :description="uiText('ui.dataset_list_8da1cc5c')"
  >
    <NButton type="primary" :disabled="readonly" @click="router.push('/datasets/new')">
      <template #icon><Plus :size="16" /></template>
      {{ uiText('ui.dataset_list_e78bd5fa') }}
    </NButton>
  </PageHeader>
  <NCard :bordered="false">
    <QueryToolbar>
      <NInput
        :value="filters.q"
        clearable
        :placeholder="t('search')"
        @update:value="update({ q: $event, page: 1 })"
      />
      <NSelect
        :value="filters.status || null"
        v-select-trigger-name="uiText('ui.dataset_list_62e951a6')"
        clearable
        :placeholder="uiText('ui.dataset_list_62e951a6')"
        :options="[
          { label: uiText('ui.dataset_list_176a2eb4'), value: 'published' },
          { label: uiText('ui.dataset_list_0f436818'), value: 'draft' },
        ]"
        @update:value="update({ status: $event, page: 1 })"
      />
      <NSelect
        :value="filters.sort"
        v-select-trigger-name="uiText('sort')"
        :options="[
          { label: uiText('ui.dataset_list_5ebd027d'), value: 'updatedAt' },
          { label: uiText('ui.dataset_list_0ea96767'), value: 'name' },
        ]"
        @update:value="update({ sort: $event, page: 1 })"
      />
    </QueryToolbar>
    <AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
    >
      <NDataTable
        :columns="columns"
        :data="query.data.value?.data ?? []"
        :row-key="(dataset) => dataset.id"
        :scroll-x="1080"
        :bordered="false"
        table-layout="fixed"
      />
    </AsyncState>
    <div class="pagination">
      <span>{{ t('total', { total: query.data.value?.meta.total ?? 0 }) }}</span>
      <NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        @update:page="update({ page: $event })"
      />
    </div>
  </NCard>
  <ConfirmDialog
    :show="!!deleteId"
    :title="uiText('ui.dataset_list_87510d58')"
    :description="uiText('ui.dataset_list_bbf432ef')"
    :pending="actions.remove.isPending.value"
    @confirm="remove"
    @cancel="deleteId = ''"
  />
</template>
