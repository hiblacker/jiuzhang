<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, h, ref } from 'vue'
import {
  NCard,
  NButton,
  NInput,
  NSelect,
  NDatePicker,
  NDataTable,
  NPagination,
  NDrawer,
  NDrawerContent,
  NDescriptions,
  NDescriptionsItem,
} from 'naive-ui'
import { useAudit } from '@/modules/identity'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { useListRoute } from '@/shared/composables/use-list-route'
import { useDisplayTime } from '@/shared/composables/use-display-time'
import { downloadText } from '@/shared/lib/download'
import { toCsv } from '@/shared/lib/csv'
import type { Model } from '@/shared/api/types'
const { filters, update, queryValue, bindPagination } = useListRoute(),
  params = computed(() => ({
    q: filters.value.q,
    actor: queryValue('actor'),
    action: queryValue('action'),
    resource: queryValue('resource'),
    from: queryValue('from'),
    to: queryValue('to'),
    page: String(filters.value.page),
    pageSize: String(filters.value.pageSize),
  })),
  query = useAudit(params),
  selected = ref<Model<'Audit'> | null>(null)
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
const displayTime = useDisplayTime()
const actionLabels: Record<string, string> = {
  post: uiText('identity.audit.actions.post'),
  patch: uiText('identity.audit.actions.patch'),
  delete: uiText('identity.audit.actions.delete'),
  call: uiText('identity.audit.actions.call'),
  publish: uiText('identity.audit.actions.publish'),
  failed: uiText('identity.audit.actions.failed'),
  blocked: uiText('identity.audit.actions.blocked'),
  succeeded: uiText('identity.audit.actions.succeeded'),
  ready: uiText('identity.audit.actions.ready'),
  expired: uiText('identity.audit.actions.expired'),
  retry: uiText('identity.audit.actions.retry'),
  schedule: uiText('identity.audit.actions.schedule'),
  queued: uiText('identity.audit.actions.queued'),
  running: uiText('identity.audit.actions.running'),
  validating: uiText('identity.audit.actions.validating'),
  publishing: uiText('identity.audit.actions.publishing'),
  seed: uiText('identity.audit.actions.seed'),
}
const actionOptions = Object.entries(actionLabels).map(([value, label]) => ({ value, label }))
const columns = [
  {
    title: uiText('ui.audit_89b4aa63'),
    key: 'at',
    render: (row: Model<'Audit'>) =>
      h('time', { datetime: row.at, title: row.at }, displayTime(row.at)),
  },
  { title: uiText('ui.audit_ffb50d38'), key: 'actor' },
  {
    title: uiText('ui.audit_c0939594'),
    key: 'action',
    render: (row: Model<'Audit'>) => actionLabels[row.action] ?? row.action,
  },
  { title: uiText('ui.audit_c6464f4f'), key: 'resource' },
  {
    title: uiText('ui.audit_24f28fbd'),
    key: 'resourceId',
    render: (row: Model<'Audit'>) =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          'aria-label': uiText('identity.audit.openDetail', { id: row.id }),
          onClick: () => (selected.value = row),
        },
        { default: () => row.resourceId || '—' },
      ),
  },
  { title: uiText('ui.audit_26670dda'), key: 'detail' },
]
function exportRows() {
  downloadText(
    'jiuzhang-audit.csv',
    toCsv(
      query.data.value?.data ?? [],
      columns.map((c) => c.key),
    ),
    'text/csv',
  )
}
</script>
<template>
  <PageHeader :title="uiText('ui.audit_7666cd43')" :description="uiText('ui.audit_df1bc28d')"
    ><NButton :disabled="!query.data.value?.data.length" @click="exportRows">{{
      uiText('ui.audit_45c33c87')
    }}</NButton></PageHeader
  ><NCard :bordered="false"
    ><QueryToolbar
      ><NInput
        :aria-label="uiText('ui.audit_1f4989c3')"
        :value="filters.q"
        clearable
        :placeholder="uiText('ui.audit_1f4989c3')"
        @update:value="update({ q: $event, page: 1 })"
      />
      <NInput
        :aria-label="uiText('ui.audit_ffb50d38')"
        :value="queryValue('actor')"
        clearable
        :placeholder="uiText('ui.audit_ffb50d38')"
        @update:value="update({ actor: $event, page: 1 })"
      />
      <NSelect
        :aria-label="uiText('ui.audit_c0939594')"
        :virtual-scroll="false"
        :value="queryValue('action') || null"
        clearable
        :placeholder="uiText('ui.audit_c0939594')"
        :options="actionOptions"
        @update:value="update({ action: $event, page: 1 })"
      />
      <NSelect
        :aria-label="uiText('ui.audit_c6464f4f')"
        :value="queryValue('resource') || null"
        clearable
        :placeholder="uiText('ui.audit_c6464f4f')"
        :options="
          [
            'sources',
            'datasets',
            'dataset-folders',
            'tasks',
            'runs',
            'warehouse',
            'imports',
            'exports',
            'queries',
            'governance',
            'services',
            'system',
            'demo',
          ].map((value) => ({ value, label: value }))
        "
        @update:value="update({ resource: $event, page: 1 })"
      />
      <NDatePicker
        type="daterange"
        clearable
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
        :data="query.data.value?.data ?? []"
        :row-key="(row) => row.id"
        :columns="columns"
        :row-props="(row) => ({ onClick: () => (selected = row) })"
        :bordered="false"
        :scroll-x="1000"
    /></AsyncState>
    <div class="pagination">
      <span
        >{{ uiText('ui.audit_3b6ef811') }}{{ query.data.value?.meta.total ?? 0
        }}{{ uiText('ui.audit_bce2ef61') }}</span
      ><NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        @update:page="update({ page: $event })"
      /></div></NCard
  ><NDrawer
    :aria-label="uiText('ui.audit_18c5e1d4')"
    :show="!!selected"
    width="min(440px, 100vw)"
    @update:show="!$event && (selected = null)"
    ><NDrawerContent :title="uiText('ui.audit_18c5e1d4')" closable
      ><NDescriptions :column="1" bordered
        ><NDescriptionsItem v-for="column in columns" :key="column.key" :label="column.title"
          ><span class="audit-value">{{
            selected && column.key === 'at'
              ? displayTime(selected.at) + ' · ' + selected.at
              : selected?.[column.key as keyof Model<'Audit'>]
          }}</span></NDescriptionsItem
        ></NDescriptions
      ></NDrawerContent
    ></NDrawer
  >
</template>
<style scoped>
.audit-value {
  overflow-wrap: anywhere;
}
</style>
