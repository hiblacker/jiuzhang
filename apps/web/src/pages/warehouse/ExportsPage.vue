<script setup lang="ts">
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NInput,
  NSelect,
  NPagination,
  NCard,
  NButton,
  NDataTable,
  NTag,
  NProgress,
  useMessage,
  type DataTableColumns,
} from 'naive-ui'
import { useExports, useWarehouseActions } from '@/modules/warehouse'
import { PageHeader } from '@/shared/ui/page-header'
import { useListRoute } from '@/shared/composables/use-list-route'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { AsyncState } from '@/shared/ui/async-state'
import { downloadText } from '@/shared/lib/download'
import type { Model } from '@/shared/api/types'
const router = useRouter(),
  message = useMessage(),
  { filters, update, bindPagination } = useListRoute(),
  query = useExports(() =>
    Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
  ),
  actions = useWarehouseActions()
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
async function download(id: string) {
  if (actions.download.isPending.value) return
  try {
    const record = await actions.download.mutateAsync(id)
    if (record.status !== 'ready') {
      message.error(
        record.status === 'expired'
          ? uiText('ui.exports_1354374f')
          : uiText('warehouse.exportFailedAccess'),
      )
      return
    }
    downloadText(
      record.fileName,
      record.content,
      record.format === 'csv' ? 'text/csv' : 'application/json',
    )
  } catch {
    /* Mutation cache owns API error feedback. */
  }
}
function progressStatus(status: Model<'Export'>['status']) {
  if (status === 'failed') return 'error'
  if (status === 'ready') return 'success'
  return 'default'
}
const columns: DataTableColumns<Model<'Export'>> = [
  { title: uiText('ui.exports_1275f6fe'), key: 'fileName' },
  { title: uiText('ui.exports_9d2601c8'), key: 'format' },
  {
    title: uiText('ui.exports_62e951a6'),
    key: 'status',
    render: (e) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: e.status === 'ready' ? 'success' : 'warning' },
        () =>
          ({
            preparing: uiText('warehouse.preparing'),
            ready: uiText('ui.exports_269cd52e'),
            expired: uiText('ui.exports_1354374f'),
            failed: uiText('ui.exports_3e3c8068'),
          })[e.status],
      ),
  },
  {
    title: uiText('warehouse.progress'),
    key: 'progress',
    width: 160,
    render: (e) =>
      h(NProgress, { type: 'line', percentage: e.progress, status: progressStatus(e.status) }),
  },
  {
    title: uiText('warehouse.failureReason'),
    key: 'error',
    render: (e) => (e.status === 'failed' ? uiText('warehouse.exportFailedAccess') : '—'),
  },
  { title: uiText('ui.exports_84e3802f'), key: 'createdAt' },
  {
    title: uiText('ui.exports_f3ea6d34'),
    key: 'actions',
    render: (e) =>
      h(
        NButton,
        {
          size: 'small',
          disabled: e.status !== 'ready' || actions.download.isPending.value,
          loading: actions.download.isPending.value && actions.download.variables.value === e.id,
          onClick: () => download(e.id),
        },
        () => uiText('ui.exports_2b9d0131'),
      ),
  },
]
</script>
<template>
  <PageHeader :title="uiText('ui.exports_603a049b')" :description="uiText('warehouse.realExports')"
    ><NButton type="primary" @click="router.push('/warehouse/query')">{{
      uiText('ui.exports_9953cdb5')
    }}</NButton></PageHeader
  ><NCard :bordered="false"
    ><QueryToolbar>
      <NInput
        :value="filters.q"
        clearable
        :placeholder="uiText('warehouse.searchTransfers')"
        @update:value="update({ q: $event, page: 1 })"
      />
      <NSelect
        :value="filters.status || null"
        clearable
        :placeholder="uiText('status')"
        v-select-trigger-name="uiText('status')"
        :options="[
          { value: 'preparing', label: uiText('warehouse.preparing') },
          { value: 'ready', label: uiText('warehouse.ready') },
          { value: 'expired', label: uiText('warehouse.expired') },
          { value: 'failed', label: uiText('states.failed') },
        ]"
        @update:value="update({ status: $event, page: 1 })"
      /> </QueryToolbar
    ><AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><NDataTable
        :data="query.data.value?.data ?? []"
        :columns="columns"
        :scroll-x="950"
        :bordered="false"
    /></AsyncState>
    <div class="pagination">
      <span>{{ uiText('total', { total: query.data.value?.meta.total ?? 0 }) }}</span>
      <NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        show-size-picker
        :page-sizes="[20, 50, 100]"
        @update:page="update({ page: $event })"
        @update:page-size="update({ pageSize: $event, page: 1 })"
      /></div
  ></NCard>
</template>
