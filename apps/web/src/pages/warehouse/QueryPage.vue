<script setup lang="ts">
import { vAccessibleTabs } from '@/shared/ui/accessible-tabs'
import { useRouteTab } from '@/shared/composables/use-route-tab'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { ref, computed, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NSelect,
  NAlert,
  NDataTable,
  NTabs,
  NTabPane,
  NSpace,
  NInput,
  NPagination,
} from 'naive-ui'
import { useTables, useQueries, useQueryResult, useWarehouseActions } from '@/modules/warehouse'
import { useI18n } from 'vue-i18n'
import { useListRoute } from '@/shared/composables/use-list-route'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { AsyncState } from '@/shared/ui/async-state'
import { PageHeader } from '@/shared/ui/page-header'
const SqlEditor = defineAsyncComponent(() => import('@/shared/editors/SqlEditor.vue'))
const route = useRoute(),
  router = useRouter(),
  tables = useTables({ pageSize: '100' }),
  { filters, update, bindPagination } = useListRoute(),
  history = useQueries(() =>
    Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
  ),
  actions = useWarehouseActions(),
  sql = ref(''),
  tableId = ref(String(route.query.tableId ?? ''))
bindPagination(() =>
  history.isSuccess.value && !history.isFetching.value ? history.data.value?.meta : undefined,
)
const { t } = useI18n()
const tab = useRouteTab(['result', 'history'], 'result')
const exportOutcome = ref<'ready' | 'failed'>('ready')
const queryId = computed(() => String(route.query.queryId ?? ''))
const result = useQueryResult(queryId)
const resultData = computed(() => result.data.value)
const running = computed(
  () => actions.query.isPending.value || resultData.value?.status === 'running',
)
watch(
  () => tables.data.value,
  (data) => {
    if (data?.data.length && !sql.value) {
      const table = data.data.find((t) => t.id === tableId.value) ?? data.data[0]!
      tableId.value = table.id
      sql.value = 'SELECT * FROM ' + table.name + ' LIMIT 100'
    }
  },
  { immediate: true },
)
function selectTable(id: string) {
  tableId.value = id
  const table = tables.data.value?.data.find((t) => t.id === id)
  if (table) sql.value = 'SELECT * FROM ' + table.name + ' LIMIT 100'
}
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
async function exportResult(format: 'csv' | 'json') {
  if (resultData.value?.status !== 'succeeded' || actions.export.isPending.value) return
  try {
    await actions.export.mutateAsync({
      queryId: resultData.value.id,
      format,
      outcome: exportOutcome.value,
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
      :disabled="!sql.trim() || tables.isLoading.value"
      @click="run"
      >{{ uiText('ui.query_31e15446') }}</NButton
    ></PageHeader
  ><NCard :bordered="false" class="mb"
    ><NAlert type="info" class="mb">{{ t('warehouse.privateResults') }}</NAlert
    ><NAlert type="info" class="mb">{{ t('warehouse.queryHint') }}</NAlert
    ><NSelect
      :value="tableId || null"
      :options="tables.data.value?.data.map((t) => ({ label: t.name, value: t.id }))"
      :placeholder="uiText('ui.query_074ab09a')"
      class="mb"
      @update:value="selectTable"
    /><SqlEditor v-model="sql" /><NAlert
      v-if="actions.query.error.value"
      type="error"
      style="margin-top: 20px"
      >{{ uiText('ui.query_6a2a3277') }}</NAlert
    ></NCard
  ><NCard :bordered="false"
    ><NTabs
      v-accessible-tabs="uiText('ui.query_5ecc0135')"
      :value="tab"
      type="line"
      @update:value="tab = $event"
      ><NTabPane name="result" :tab="uiText('ui.query_afeb896e')"
        ><NSpace justify="end" class="mb"
          ><NSelect
            v-model:value="exportOutcome"
            :aria-label="t('warehouse.scenario')"
            style="width: 190px"
            :options="[
              { label: t('warehouse.exportSuccess'), value: 'ready' },
              { label: t('warehouse.exportFailure'), value: 'failed' },
            ]"
          />
          <NButton
            :disabled="resultData?.status !== 'succeeded'"
            :loading="actions.export.isPending.value"
            @click="exportResult('csv')"
            >{{ uiText('ui.query_7e9cc863') }}</NButton
          ><NButton
            :disabled="resultData?.status !== 'succeeded' || actions.export.isPending.value"
            @click="exportResult('json')"
            >{{ uiText('ui.query_3b9ec1c4') }}</NButton
          ></NSpace
        ><NAlert v-if="actions.export.error.value" type="error">{{
          uiText('ui.query_df658bd3')
        }}</NAlert
        ><NAlert v-if="resultData?.status === 'failed'" type="error">{{
          uiText('ui.query_6a2a3277')
        }}</NAlert
        ><NAlert v-if="resultData?.status === 'canceled'" type="warning">{{
          t('states.canceled')
        }}</NAlert>
        <AsyncState
          :loading="result.isLoading.value || resultData?.status === 'running'"
          :error="result.error.value || actions.cancelQuery.error.value"
          @retry="result.refetch()"
        >
          <NDataTable
            :data="resultData?.rows ?? []"
            :columns="resultData?.columns.map((key) => ({ title: key, key })) ?? []"
            :bordered="false" /></AsyncState></NTabPane
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
