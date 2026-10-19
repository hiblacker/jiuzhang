<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NInput,
  NDataTable,
  NTag,
  NSpace,
  NPagination,
  type DataTableColumns,
} from 'naive-ui'
import { useServices, useServiceActions } from '@/modules/services'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { useCan } from '@/shared/security/permissions'
import { useListRoute } from '@/shared/composables/use-list-route'
import type { Model } from '@/shared/api/types'
const router = useRouter(),
  { filters, update, bindPagination } = useListRoute(),
  query = useServices(() =>
    Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
  ),
  actions = useServiceActions(),
  readonly = computed(() => !canWrite.value)
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
async function toggle(service: Model<'Service'>) {
  if (actions.toggle.isPending.value) return
  try {
    await actions.toggle.mutateAsync({ id: service.id, enabled: !service.enabled })
  } catch {}
}
const columns = computed<DataTableColumns<Model<'Service'>>>(() => [
  {
    title: uiText('ui.services_d82acb1b'),
    key: 'name',
    render: (s) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => router.push('/services/' + s.id) },
        () => s.name,
      ),
  },
  {
    title: uiText('ui.services_62e951a6'),
    key: 'enabled',
    render: (s) =>
      h(NTag, { size: 'small', bordered: false, type: s.enabled ? 'success' : 'default' }, () =>
        s.enabled ? uiText('ui.services_176a2eb4') : uiText('ui.services_6c7dcbb7'),
      ),
  },
  { title: uiText('ui.services_61a9d8b4'), key: 'callCount' },
  { title: uiText('ui.services_974d383f'), key: 'owner' },
  {
    title: uiText('ui.services_f3ea6d34'),
    key: 'actions',
    render: (s) =>
      h(NSpace, {}, () => [
        h(
          NButton,
          {
            size: 'small',
            disabled: readonly.value,
            onClick: () => router.push('/services/' + s.id + '/edit'),
          },
          () => uiText('ui.services_a7f814c0'),
        ),
        h(
          NButton,
          {
            size: 'small',
            disabled: readonly.value,
            loading: actions.toggle.isPending.value,
            onClick: () => toggle(s),
          },
          () => (s.enabled ? uiText('ui.services_d989e551') : uiText('ui.services_94f172d0')),
        ),
      ]),
  },
])
</script>
<template>
  <PageHeader :title="uiText('ui.services_04d19d18')" :description="uiText('ui.services_e6d8c3b8')"
    ><NButton type="primary" :disabled="readonly" @click="router.push('/services/new')">{{
      uiText('ui.services_6d600202')
    }}</NButton></PageHeader
  ><NCard :bordered="false"
    ><NInput
      :value="filters.q"
      @update:value="update({ q: $event, page: 1 })"
      :placeholder="uiText('ui.services_339febe4')"
      clearable
      style="max-width: 320px; margin-bottom: 24px" /><AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><NDataTable
        :data="query.data.value?.data ?? []"
        :columns="columns"
        :scroll-x="760"
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
