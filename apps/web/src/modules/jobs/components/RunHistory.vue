<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDataTable, NPagination, type DataTableColumns } from 'naive-ui'
import type { Model } from '@/shared/api/types'
import { AsyncState } from '@/shared/ui/async-state'
import { useListRoute } from '@/shared/composables/use-list-route'
import { useDisplayTime } from '@/shared/composables/use-display-time'
import { useRuns } from '../composables/use-jobs'

const props = defineProps<{
  scope: { sourceId: string } | { datasetId: string } | { taskId: string }
}>()
const emit = defineEmits<{ select: [id: string] }>()
const { t } = useI18n()
const dateTime = useDisplayTime()
const { filters, update, bindPagination } = useListRoute()
const query = useRuns(() => ({
  ...props.scope,
  page: String(filters.value.page),
  pageSize: String(filters.value.pageSize),
}))
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
const columns = computed<DataTableColumns<Model<'Run'>>>(() => [
  {
    title: 'Run ID',
    key: 'id',
    width: 120,
    render: (run) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => emit('select', run.id) },
        () => run.id,
      ),
  },
  { title: t('status'), key: 'status', width: 100, render: (run) => t('states.' + run.status) },
  { title: t('jobs.dataset'), key: 'datasetId', width: 110 },
  {
    title: t('jobs.runVersion'),
    key: 'datasetVersion',
    width: 110,
    render: (run) => 'v' + run.datasetVersion,
  },
  {
    title: t('jobs.startedAt'),
    key: 'startedAt',
    width: 190,
    render: (run) => dateTime(run.startedAt),
  },
])
</script>
<template>
  <section :aria-label="t('jobs.history')" class="run-history">
    <AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
    >
      <NDataTable
        :columns="columns"
        :data="query.data.value?.data ?? []"
        :row-key="(run) => run.id"
        :scroll-x="630"
        :bordered="false"
      />
    </AsyncState>
    <div v-if="query.data.value && !query.isError.value" class="pagination">
      <span>{{ t('total', { total: query.data.value.meta.total ?? 0 }) }}</span>
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
.run-history {
  min-width: 0;
}
.pagination {
  flex-wrap: wrap;
}
</style>
