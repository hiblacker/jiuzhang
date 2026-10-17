<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDataTable, NPagination, type DataTableColumns } from 'naive-ui'
import { useRuns } from '../composables/use-jobs'
import { AsyncState } from '@/shared/ui/async-state'
import { useListRoute } from '@/shared/composables/use-list-route'
import { useDisplayTime } from '@/shared/composables/use-display-time'
import type { Model } from '@/shared/api/types'

const props = defineProps<{ ruleId: string }>()
const emit = defineEmits<{ select: [id: string] }>()
const { t } = useI18n()
const dateTime = useDisplayTime()
const { filters, update, bindPagination } = useListRoute('qualityRuns')
const query = useRuns(() => ({
  qualityRuleId: props.ruleId,
  page: String(filters.value.page),
  pageSize: String(filters.value.pageSize),
}))
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
type QualityRunRow = Model<'Run'>['qualityResults'][number] & {
  runId: string
  datasetVersion: Model<'Run'>['datasetVersion']
  startedAt: Model<'Run'>['startedAt']
}
const rows = computed<QualityRunRow[]>(
  () =>
    query.data.value?.data.flatMap((run) =>
      run.qualityResults
        .filter((result) => result.ruleId === props.ruleId)
        .map((result) => ({
          ...result,
          runId: run.id,
          datasetVersion: run.datasetVersion,
          startedAt: run.startedAt,
        })),
    ) ?? [],
)
const columns = computed<DataTableColumns<QualityRunRow>>(() => [
  {
    title: 'Run ID',
    key: 'runId',
    width: 120,
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          onClick: () => emit('select', row.runId),
        },
        () => row.runId,
      ),
  },
  {
    title: t('jobs.qualityRuleVersion'),
    key: 'version',
    width: 110,
    render: (row) => 'v' + row.version,
  },
  {
    title: t('jobs.runVersion'),
    key: 'datasetVersion',
    width: 120,
    render: (row) => 'v' + row.datasetVersion,
  },
  { title: t('jobs.qualityResult'), key: 'result', width: 90 },
  { title: t('jobs.qualityMessage'), key: 'message', width: 240 },
  {
    title: t('jobs.startedAt'),
    key: 'startedAt',
    width: 190,
    render: (row) => dateTime(row.startedAt),
  },
])
</script>
<template>
  <section :aria-label="t('jobs.qualityHistory')" class="quality-run-history">
    <p class="muted">{{ t('jobs.qualityHistoryHint') }}</p>
    <AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
    >
      <NDataTable :columns="columns" :data="rows" :scroll-x="870" :bordered="false" />
    </AsyncState>
    <div v-if="query.data.value && !query.isError.value" class="pagination">
      <span>{{ t('jobs.qualityRunTotal', { total: query.data.value.meta.total ?? 0 }) }}</span>
      <NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value.meta.total ?? 0"
        :page-sizes="[20, 50, 100]"
        show-size-picker
        @update:page="update({ page: $event })"
        @update:page-size="update({ pageSize: $event, page: 1 })"
      />
    </div>
  </section>
</template>
<style scoped>
.quality-run-history {
  min-width: 0;
}
.pagination {
  flex-wrap: wrap;
}
</style>
