<script setup lang="ts">
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NInput,
  NSelect,
  NDataTable,
  NTag,
  NPagination,
  NAlert,
  type DataTableColumns,
} from 'naive-ui'
import { useTables, useSubjectDomains } from '@/modules/warehouse'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { useListRoute } from '@/shared/composables/use-list-route'
import type { Model } from '@/shared/api/types'
const route = useRoute(),
  router = useRouter(),
  { filters, update, queryValue, bindPagination } = useListRoute(),
  params = computed(() => ({
    q: filters.value.q,
    layer: String(route.query.layer ?? ''),
    subjectDomain: queryValue('subjectDomain'),
    page: String(filters.value.page),
    pageSize: String(filters.value.pageSize),
  })),
  query = useTables(params)
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
const domains = useSubjectDomains()
const columns = computed<DataTableColumns<Model<'Table'>>>(() => [
  {
    title: uiText('ui.tables_4b2d958f'),
    key: 'name',
    render: (t) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => router.push('/warehouse/tables/' + t.id) },
        () => t.name,
      ),
  },
  {
    title: uiText('ui.tables_752b56a4'),
    key: 'layer',
    render: (t) => h(NTag, { size: 'small', bordered: false }, () => t.layer),
  },
  { title: uiText('ui.tables_5ae10a2b'), key: 'rowCount' },
  {
    title: uiText('warehouse.subjectDomain'),
    key: 'subjectDomain',
    render: (table) => table.subjectDomain || uiText('warehouse.unclassified'),
  },
  { title: uiText('ui.tables_974d383f'), key: 'owner' },
  {
    title: uiText('ui.tables_c789c17a'),
    key: 'datasetVersion',
    render: (t) => 'v' + t.datasetVersion,
  },
  { title: uiText('ui.tables_093dea88'), key: 'updatedAt' },
])
</script>
<template>
  <PageHeader :title="uiText('ui.tables_25d85ef7')" :description="uiText('ui.tables_c6e4ea11')"
    ><NButton @click="router.push('/warehouse/imports')">{{ uiText('ui.tables_c92a5d17') }}</NButton
    ><NButton type="primary" @click="router.push('/warehouse/query')">{{
      uiText('ui.tables_b335a616')
    }}</NButton></PageHeader
  ><NCard :bordered="false"
    ><QueryToolbar
      ><NInput
        :value="filters.q"
        :placeholder="uiText('ui.tables_267350f9')"
        clearable
        @update:value="update({ q: $event, page: 1 })"
      /><NSelect
        :value="params.layer || null"
        v-select-trigger-name="uiText('ui.tables_e24230d0')"
        clearable
        :placeholder="uiText('ui.tables_e24230d0')"
        :options="['ODS', 'DWD', 'DWS', 'ADS'].map((value) => ({ value, label: value }))"
        @update:value="update({ layer: $event, page: 1 })"
      />
      <NSelect
        :value="params.subjectDomain || null"
        v-select-trigger-name="uiText('warehouse.subjectDomain')"
        :placeholder="uiText('warehouse.subjectDomain')"
        :loading="domains.isLoading.value"
        clearable
        :options="[
          { label: uiText('warehouse.unclassified'), value: 'none' },
          ...(domains.data.value ?? []).map((value) => ({ value, label: value })),
        ]"
        @update:value="update({ subjectDomain: $event, page: 1 })"
      />
    </QueryToolbar>
    <NAlert v-if="domains.error.value" type="error"
      ><NButton @click="domains.refetch()">{{ uiText('retry') }}</NButton></NAlert
    ><AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><NDataTable
        :columns="columns"
        :data="query.data.value?.data ?? []"
        :bordered="false"
        :scroll-x="900"
    /></AsyncState>
    <div class="pagination">
      <span
        >{{ uiText('ui.tables_3b6ef811') }}{{ query.data.value?.meta.total ?? 0
        }}{{ uiText('ui.tables_bce2ef61') }}</span
      ><NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        @update:page="update({ page: $event })"
      /></div
  ></NCard>
</template>
