<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NInput,
  NSelect,
  NButton,
  NDataTable,
  NTag,
  NSpace,
  NPagination,
  NAlert,
  type DataTableColumns,
} from 'naive-ui'
import { Star } from 'lucide-vue-next'
import { useCatalog, useGovernanceActions } from '@/modules/governance'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { useListRoute } from '@/shared/composables/use-list-route'
import { errorKey } from '@/shared/api/error-message'
import type { Model } from '@/shared/api/types'
const router = useRouter(),
  { filters, update, queryValue, bindPagination } = useListRoute(),
  params = computed(() => ({
    q: filters.value.q,
    kind: queryValue('kind'),
    owner: queryValue('owner'),
    tag: queryValue('tag'),
    certified: queryValue('certified'),
    favorite: queryValue('favorite'),
    page: String(filters.value.page),
    pageSize: String(filters.value.pageSize),
  })),
  query = useCatalog(params),
  actions = useGovernanceActions()
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
async function favorite(item: Model<'CatalogItem'>) {
  if (actions.favorite.isPending.value) return
  try {
    await actions.favorite.mutateAsync({ id: item.id, favorite: !item.favorite })
  } catch {}
}
const columns = computed<DataTableColumns<Model<'CatalogItem'>>>(() => [
  {
    title: uiText('ui.catalog_f016adbb'),
    key: 'name',
    width: 260,
    render: (a) =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          class: 'resource-name',
          title: a.name,
          onClick: () => router.push(a.path),
        },
        () => h('span', { class: 'resource-name__text' }, a.name),
      ),
  },
  {
    title: uiText('ui.catalog_c6464f4f'),
    key: 'kind',
    width: 110,
    render: (a) =>
      ({
        source: uiText('ui.catalog_a3ccf702'),
        dataset: uiText('ui.catalog_fc2b4735'),
        table: uiText('ui.catalog_25d85ef7'),
      })[a.kind],
  },
  { title: uiText('ui.catalog_974d383f'), key: 'owner', minWidth: 120 },
  {
    title: uiText('ui.catalog_ae0a7afe'),
    key: 'tags',
    minWidth: 220,
    render: (a) =>
      h(NSpace, {}, () =>
        a.tags.map((tag) => h(NTag, { size: 'small', bordered: false }, () => tag)),
      ),
  },
  {
    title: uiText('ui.catalog_32c808cb'),
    key: 'certified',
    width: 100,
    render: (a) => (a.certified ? uiText('ui.catalog_176a2eb4') : uiText('ui.catalog_e7cb4599')),
  },
  {
    title: uiText('ui.catalog_d07cee78'),
    key: 'favorite',
    width: 80,
    fixed: 'right',
    render: (a) =>
      h(
        NButton,
        {
          quaternary: true,
          circle: true,
          type: a.favorite ? 'warning' : 'default',
          'aria-label': a.favorite ? uiText('ui.catalog_26acae04') : uiText('ui.catalog_d07cee78'),
          loading: actions.favorite.isPending.value,
          onClick: () => favorite(a),
        },
        () => h(Star, { size: 17, fill: a.favorite ? 'currentColor' : 'none' }),
      ),
  },
])
</script>
<template>
  <PageHeader :title="uiText('ui.catalog_c908d3ea')" :description="uiText('ui.catalog_a3abbcd1')"
    ><NButton @click="router.push('/governance/lineage')">{{
      uiText('ui.catalog_49aed479')
    }}</NButton
    ><NButton @click="router.push('/governance/quality')">{{
      uiText('ui.catalog_e974beee')
    }}</NButton
    ><NButton @click="router.push('/governance/masking')">{{
      uiText('ui.catalog_0549993d')
    }}</NButton></PageHeader
  ><NCard :bordered="false"
    ><QueryToolbar
      ><NInput
        :value="filters.q"
        clearable
        :placeholder="uiText('ui.catalog_00ccd95b')"
        @update:value="update({ q: $event, page: 1 })"
      />
      <NSelect
        :value="queryValue('kind') || null"
        clearable
        :placeholder="uiText('type')"
        :options="[
          { value: 'source', label: uiText('nav.sources') },
          { value: 'dataset', label: uiText('nav.datasets') },
          { value: 'table', label: uiText('overview.tables') },
        ]"
        @update:value="update({ kind: $event, page: 1 })"
      />
      <NInput
        :value="queryValue('owner')"
        clearable
        :placeholder="uiText('owner')"
        @update:value="update({ owner: $event, page: 1 })"
      />
      <NInput
        :value="queryValue('tag')"
        clearable
        :placeholder="uiText('tags')"
        @update:value="update({ tag: $event, page: 1 })"
      />
      <NSelect
        :value="queryValue('certified') || null"
        clearable
        :placeholder="uiText('ui.catalog_32c808cb')"
        :options="[
          { value: 'true', label: uiText('ui.catalog_176a2eb4') },
          { value: 'false', label: uiText('ui.catalog_e7cb4599') },
        ]"
        @update:value="update({ certified: $event, page: 1 })"
      />
      <NSelect
        :value="queryValue('favorite') || null"
        clearable
        :placeholder="uiText('ui.catalog_d07cee78')"
        :options="[{ value: 'true', label: uiText('ui.catalog_d07cee78') }]"
        @update:value="update({ favorite: $event, page: 1 })"
      /> </QueryToolbar
    ><NAlert v-if="actions.favorite.error.value" type="error" class="mb">{{
      uiText(errorKey(actions.favorite.error.value))
    }}</NAlert>
    <AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><NDataTable
        :columns="columns"
        :data="query.data.value?.data ?? []"
        :row-key="(row) => row.id"
        :bordered="false"
        :scroll-x="850"
        table-layout="fixed"
    /></AsyncState>
    <div class="pagination">
      <span
        >{{ uiText('ui.catalog_3b6ef811') }}{{ query.data.value?.meta.total ?? 0
        }}{{ uiText('ui.catalog_e4886322') }}</span
      ><NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        @update:page="update({ page: $event })"
      /></div
  ></NCard>
</template>
