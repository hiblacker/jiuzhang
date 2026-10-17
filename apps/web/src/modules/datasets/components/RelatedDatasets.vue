<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDataTable, NInput, NPagination, type DataTableColumns } from 'naive-ui'
import { useDatasets } from '../composables/use-datasets'
import { AsyncState } from '@/shared/ui/async-state'
import { useListRoute } from '@/shared/composables/use-list-route'
import type { Model } from '@/shared/api/types'

const props = defineProps<{
  relation: { qualityRuleId: string } | { maskPolicyId: string }
}>()
const emit = defineEmits<{ select: [id: string] }>()
const { t } = useI18n()
const { filters, update, bindPagination } = useListRoute('datasets')
const query = useDatasets(() => ({
  ...props.relation,
  q: filters.value.q,
  page: String(filters.value.page),
  pageSize: String(filters.value.pageSize),
  sort: 'name',
}))
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
const columns = computed<DataTableColumns<Model<'Dataset'>>>(() => [
  {
    title: t('datasets.related.name'),
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
          onClick: () => emit('select', dataset.id),
        },
        () => dataset.name,
      ),
  },
  {
    title: t('status'),
    key: 'status',
    width: 110,
    render: (dataset) => t('datasets.related.states.' + dataset.status),
  },
  {
    title: t('datasets.related.publishedVersion'),
    key: 'publishedVersion',
    width: 120,
    render: (dataset) => (dataset.publishedVersion ? 'v' + dataset.publishedVersion : '—'),
  },
])
</script>
<template>
  <section :aria-label="t('datasets.related.title')" class="related-datasets">
    <NInput
      :value="filters.q"
      :input-props="{ 'aria-label': t('datasets.related.search') }"
      :placeholder="t('datasets.related.search')"
      clearable
      @update:value="update({ q: $event, page: 1 })"
    />
    <p class="muted">{{ t('datasets.related.hint') }}</p>
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
        :scroll-x="490"
        table-layout="fixed"
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
.related-datasets {
  min-width: 0;
}
.pagination {
  flex-wrap: wrap;
}
</style>
