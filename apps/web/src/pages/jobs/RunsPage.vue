<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NInput,
  NSelect,
  NDatePicker,
  NDataTable,
  NTag,
  NPagination,
  type DataTableColumns,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRuns, RunActions } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { useListRoute } from '@/shared/composables/use-list-route'
import { useDisplayTime } from '@/shared/composables/use-display-time'
const dateTime = useDisplayTime()
import type { Model } from '@/shared/api/types'
const { t } = useI18n(),
  router = useRouter(),
  { filters, update, queryValue, bindPagination } = useListRoute(),
  params = computed(() => ({
    ...Object.fromEntries(Object.entries(filters.value).map(([k, v]) => [k, String(v)])),
    trigger: queryValue('trigger'),
    taskId: queryValue('taskId'),
    from: queryValue('from'),
    to: queryValue('to'),
  })),
  query = useRuns(params)
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
const columns = computed<DataTableColumns<Model<'Run'>>>(() => [
  {
    title: 'Run ID',
    key: 'id',
    render: (r) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => router.push('/runs/' + r.id) },
        () => r.id,
      ),
  },
  {
    title: uiText('ui.runs_fc2b4735'),
    key: 'datasetId',
    render: (r) =>
      h(
        NButton,
        { text: true, onClick: () => router.push('/datasets/' + r.datasetId) },
        () => r.datasetId,
      ),
  },
  {
    title: uiText('ui.runs_989d1aff'),
    key: 'datasetVersion',
    render: (r) => 'v' + r.datasetVersion,
  },
  {
    title: uiText('ui.runs_62e951a6'),
    key: 'status',
    render: (r) =>
      h(
        NTag,
        {
          bordered: false,
          size: 'small',
          type: (
            {
              succeeded: 'success',
              failed: 'error',
              queued: 'warning',
              running: 'warning',
              validating: 'warning',
              publishing: 'warning',
              blocked: 'warning',
              canceled: 'default',
            } as const
          )[r.status],
        },
        () => t('states.' + r.status),
      ),
  },
  { title: uiText('ui.runs_f67f1852'), key: 'trigger' },
  { title: t('jobs.businessDate'), key: 'businessDate', render: (run) => run.businessDate ?? '—' },
  { title: uiText('ui.runs_e8868af6'), key: 'startedAt', render: (r) => dateTime(r.startedAt) },
  { title: uiText('ui.runs_05799576'), key: 'rowCount' },
  {
    title: t('jobs.runActions'),
    key: 'actions',
    width: 380,
    fixed: 'right',
    render: (run) =>
      h(RunActions, { run, size: 'small', onRetried: (id: string) => router.push('/runs/' + id) }),
  },
])
</script>
<template>
  <PageHeader :title="uiText('ui.runs_24fb424d')" :description="uiText('ui.runs_265277ca')"
    ><NButton @click="router.push('/tasks')">{{ uiText('ui.runs_f692ff9e') }}</NButton></PageHeader
  ><NCard :bordered="false"
    ><QueryToolbar
      ><NInput
        :value="filters.q"
        clearable
        :placeholder="uiText('ui.runs_30a7bfcd')"
        @update:value="update({ q: $event, page: 1 })"
      /><NSelect
        :value="filters.status || null"
        clearable
        :placeholder="uiText('ui.runs_2a4080ad')"
        :options="
          [
            'queued',
            'running',
            'validating',
            'publishing',
            'succeeded',
            'failed',
            'blocked',
            'canceled',
          ].map((value) => ({ value, label: t('states.' + value) }))
        "
        @update:value="update({ status: $event, page: 1 })"
      />
      <NSelect
        :value="queryValue('trigger') || null"
        clearable
        :aria-label="uiText('ui.runs_f67f1852')"
        :placeholder="uiText('ui.runs_f67f1852')"
        :options="
          ['manual', 'schedule', 'retry', 'backfill'].map((value) => ({ label: value, value }))
        "
        @update:value="update({ trigger: $event ?? '', page: 1 })"
      />
      <NDatePicker
        type="daterange"
        clearable
        :aria-label="t('jobs.runTimeRange')"
        value-format="yyyy-MM-dd"
        :formatted-value="
          queryValue('from') && queryValue('to') ? [queryValue('from'), queryValue('to')] : null
        "
        @update:formatted-value="
          update({ from: $event?.[0] ?? '', to: $event?.[1] ?? '', page: 1 })
        "
      /> </QueryToolbar
    ><AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><NDataTable
        :columns="columns"
        :data="query.data.value?.data ?? []"
        :row-key="(row) => row.id"
        :bordered="false"
        :scroll-x="1300"
    /></AsyncState>
    <div class="pagination">
      <span
        >{{ uiText('ui.runs_3b6ef811') }}{{ query.data.value?.meta.total ?? 0
        }}{{ uiText('ui.runs_bce2ef61') }}</span
      ><NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        @update:page="update({ page: $event })"
      /></div
  ></NCard>
</template>
