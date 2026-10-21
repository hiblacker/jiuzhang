<script setup lang="ts">
import { vAccessibleTabs } from '@/shared/ui/accessible-tabs'
import { useRouteTab } from '@/shared/composables/use-route-tab'
import { DataPreview } from '@/shared/ui/data-preview'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { ref, computed, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NTag,
  NAlert,
  NTabs,
  NTabPane,
  NSpace,
  NInput,
  NPagination,
  useMessage,
} from 'naive-ui'
import {
  useTable,
  WarehouseTableSelect,
  useQueries,
  useQueryResult,
  useWarehouseActions,
} from '@/modules/warehouse'
import { useI18n } from 'vue-i18n'
import { useListRoute } from '@/shared/composables/use-list-route'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { AsyncState } from '@/shared/ui/async-state'
import { PageHeader } from '@/shared/ui/page-header'
const SqlEditor = defineAsyncComponent(() => import('@/shared/editors/SqlEditor.vue'))
const route = useRoute(),
  router = useRouter(),
  { filters, update, bindPagination } = useListRoute(),
  history = useQueries(() =>
    Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
  ),
  actions = useWarehouseActions(),
  message = useMessage(),
  sql = ref('')
const tableId = computed({
  get: () => (typeof route.query.tableId === 'string' ? route.query.tableId : ''),
  set: (value: string) => {
    void router.replace({ query: { ...route.query, tableId: value } })
  },
})
const table = useTable(tableId)
bindPagination(() =>
  history.isSuccess.value && !history.isFetching.value ? history.data.value?.meta : undefined,
)
const { t } = useI18n()
const tab = useRouteTab(['result', 'history'], 'result')
const queryId = computed(() => String(route.query.queryId ?? ''))
const result = useQueryResult(queryId)
const resultData = computed(() => result.data.value)
watch([queryId, () => resultData.value?.status], ([id, status], previous) => {
  if (status === 'failed' && (id !== previous[0] || previous[1] !== 'failed'))
    message.error(uiText('errors.UNKNOWN'))
})
const running = computed(
  () => actions.query.isPending.value || resultData.value?.status === 'running',
)
let loadedTableId = ''
watch(
  () => table.data.value,
  (data) => {
    if (data && data.id === tableId.value && data.id !== loadedTableId) {
      loadedTableId = data.id
      sql.value = 'SELECT * FROM ' + data.name + ' LIMIT 100'
    }
  },
  { immediate: true },
)
async function run() {
  if (running.value || !sql.value.trim()) return
  try {
    const query = await actions.query.mutateAsync({ sql: sql.value })
    await router.replace({ query: { ...route.query, tableId: tableId.value, queryId: query.id } })
  } catch {}
}
async function cancel() {
  try {
    await actions.cancelQuery.mutateAsync(queryId.value)
  } catch {
    /* mutation owns feedback */
  }
}
async function exportResult() {
  if (resultData.value?.status !== 'succeeded' || actions.export.isPending.value) return
  try {
    await actions.export.mutateAsync({
      queryId: resultData.value.id,
      format: 'csv',
    })
    await router.push('/warehouse/exports')
  } catch {}
}
</script>
<template>
  <PageHeader :title="uiText('ui.query_5ecc0135')" :description="uiText('ui.query_5ebd287f')"
    ><NButton @click="router.push('/warehouse/exports')">{{ uiText('ui.query_603a049b') }}</NButton
    ><NButton
      v-if="resultData?.status === 'running'"
      :loading="actions.cancelQuery.isPending.value"
      @click="cancel"
      >{{ t('warehouse.cancelQuery') }}</NButton
    ><NButton
      type="primary"
      :loading="running"
      :disabled="!sql.trim() || table.isLoading.value || table.isError.value"
      @click="run"
      >{{ uiText('ui.query_31e15446') }}</NButton
    ></PageHeader
  ><NCard :bordered="false" class="mb"
    ><NAlert type="info" class="mb">{{ t('warehouse.privateResults') }}</NAlert
    ><NAlert type="info" class="mb">{{ t('warehouse.realQueryHint') }}</NAlert
    ><WarehouseTableSelect
      v-model:value="tableId"
      :label="uiText('ui.query_074ab09a')"
      select-first
      class="mb" /><SqlEditor v-model="sql" :label="t('warehouse.sqlEditor')" /></NCard
  ><NCard :bordered="false"
    ><NTabs
      v-accessible-tabs="uiText('ui.query_5ecc0135')"
      :value="tab"
      type="line"
      @update:value="tab = $event"
      ><NTabPane name="result" :tab="uiText('ui.query_afeb896e')"
        ><NSpace justify="end" class="mb"
          ><NButton
            :disabled="resultData?.status !== 'succeeded'"
            :loading="actions.export.isPending.value"
            @click="exportResult"
            >{{ uiText('ui.query_7e9cc863') }}</NButton
          ></NSpace
        ><NTag v-if="resultData?.status === 'failed'" type="error" size="small">{{
          uiText('states.failed')
        }}</NTag
        ><NAlert v-if="resultData?.status === 'canceled'" type="warning">{{
          t('states.canceled')
        }}</NAlert>
        <AsyncState
          :loading="result.isLoading.value || resultData?.status === 'running'"
          :error="result.error.value || actions.cancelQuery.error.value"
          @retry="result.refetch()"
        >
          <DataPreview
            :rows="resultData?.rows ?? []"
            :columns="resultData?.columns ?? []" /></AsyncState></NTabPane
      ><NTabPane name="history" :tab="uiText('ui.query_6079f66a')"
        ><QueryToolbar
          ><NInput
            :value="filters.q"
            clearable
            :placeholder="uiText('warehouse.searchHistory')"
            @update:value="update({ q: $event, page: 1 })"
        /></QueryToolbar>
        <AsyncState
          :loading="history.isLoading.value"
          :error="history.error.value"
          :empty="history.data.value?.data.length === 0"
          @retry="history.refetch()"
        >
          <div v-for="query in history.data.value?.data" :key="query.id" class="history-row">
            <div>
              <code>{{ query.sql }}</code>
              <p>{{ query.createdAt }}</p>
            </div>
            <NButton @click="sql = query.sql">{{ uiText('ui.query_da4738ce') }}</NButton>
          </div></AsyncState
        >
        <div class="pagination">
          <span>{{ uiText('total', { total: history.data.value?.meta.total ?? 0 }) }}</span
          ><NPagination
            :page="filters.page"
            :page-size="filters.pageSize"
            :item-count="history.data.value?.meta.total ?? 0"
            @update:page="update({ page: $event })"
          /></div></NTabPane></NTabs
  ></NCard>
</template>
<style scoped>
.history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.history-row p {
  font-size: 12px;
  color: var(--textSecondary);
}
</style>
