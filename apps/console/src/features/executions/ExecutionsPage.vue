<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCode,
  NInput,
  NModal,
  NSelect,
  NTabs,
  NTabPane,
  useDialog,
  useMessage,
} from 'naive-ui'
import { Play, ListChecks } from 'lucide-vue-next'
import DataGrid from '../../shared/components/DataGrid.vue'
import DetailDrawer from '../../shared/components/DetailDrawer.vue'
import ReasonForm from '../../shared/components/ReasonForm.vue'
import { useApi } from '../../shared/composables/useApi'
import { useTabs } from '../../shared/composables/useTabs'
import type { Action, Column, Plan } from '../../shared/types'
import { planApi } from '../plans/api'
import type { TriggerInput } from '../plans/api'
import TriggerForm from '../plans/TriggerForm.vue'
import { executionApi } from './api'
import type { DeliveryWindow, Execution } from './api'

const { call, loading, error, run } = useApi()
const api = executionApi(call)
const plansApi = planApi(call)
const dialog = useDialog()
const message = useMessage()
onScopeDispose(() => dialog.destroyAll())
const plans = ref<Plan[]>([])
const executions = ref<Execution[]>([])
const windows = ref<DeliveryWindow[]>([])
const planFilter = ref<number | null>(null)
const filter = ref('')
const modal = ref(false)
const schemaReview = ref<Execution | null>(null)
const detail = ref<unknown>()
const showDetail = ref(false)
const { activeTab, tabProps, panelProps } = useTabs('executions')
const planOptions = computed(() =>
  plans.value.map(plan => ({ label: plan.source_code, value: plan.id })),
)
const visibleExecutions = computed(() =>
  executions.value.filter(item => item.source_code.includes(filter.value)),
)
const visibleWindows = computed(() =>
  windows.value.filter(item => item.source_code.includes(filter.value)),
)
const executionColumns: Column[] = [
  { key: 'id', title: '执行', width: 75 },
  { key: 'source_code', title: '来源' },
  { key: 'business_date', title: '业务日期', width: 120 },
  { key: 'attempt', title: '尝试', width: 70 },
  { key: 'state', title: '状态', state: true },
  { key: 'error_code', title: '错误', width: 250 },
]
const windowColumns: Column[] = [
  { key: 'source_code', title: '来源' },
  { key: 'business_date', title: '日期' },
  { key: 'revision', title: '修订', width: 80 },
  { key: 'state', title: '状态', state: true },
  { key: 'reason', title: '说明', width: 300 },
]
async function loadRuns() {
  const [nextExecutions, nextWindows] = await Promise.all([
    api.list(planFilter.value),
    api.windows(planFilter.value),
  ])
  executions.value = nextExecutions
  windows.value = nextWindows
}
async function load() {
  plans.value = await plansApi.list()
  await loadRuns()
}
function save(action: () => Promise<unknown>) {
  void run(async () => {
    await action()
    modal.value = false
    message.success('操作已提交')
    await load()
  })
}
function trigger(input: TriggerInput) {
  save(() => plansApi.trigger(input))
}
function approve(reason: string) {
  const id = schemaReview.value?.id
  if (id) {
    save(() => api.approveSchema(id, reason))
  }
}
function open(review: Execution | null = null) {
  schemaReview.value = review
  error.value = ''
  modal.value = true
}
function confirm(title: string, action: () => Promise<unknown>) {
  dialog.warning({
    title,
    content: '确认执行此操作？',
    positiveText: '确认',
    negativeText: '返回',
    onPositiveClick: () =>
      run(async () => {
        await action()
        message.success('操作已提交')
        await load()
      }),
  })
}
function inspect(row: Execution) {
  detail.value = row
  showDetail.value = true
}
function actions(row: Execution): Action[] {
  const items: Action[] = [{ label: '详情', run: () => inspect(row) }]
  if (['FAILED', 'INCOMPLETE', 'CANCELLED'].includes(row.state)) {
    items.push({ label: '重试', run: () => confirm('重试执行', () => api.retry(row.id)) })
  }
  if (['QUEUED', 'RUNNING'].includes(row.state)) {
    items.push({
      label: '取消',
      danger: true,
      run: () => confirm('取消执行', () => api.cancel(row.id)),
    })
  }
  const assets = row.result?.assets ?? []
  if (
    ['COMPLETE', 'FAILED'].includes(row.state)
    && (assets.some(asset => ['FILE', 'API'].includes(asset.kind))
      || (row.error_code === 'LEASE_EXPIRED' && ['FILE_SCAN', 'REST_PULL'].includes(row.kind)))
  ) {
    items.push({
      label: '重解析原件',
      run: () => confirm('重解析原件', () => api.reprocess(row.id)),
    })
  }
  if (row.error_code === 'SCHEMA_CHANGE_REVIEW_REQUIRED' && row.result?.schemaChange) {
    items.push({ label: '确认结构变更', run: () => open(row) })
  }
  return items
}
onMounted(() => run(load))
</script>
<template>
  <NAlert v-if="error && !modal" type="error" class="section-gap">
    {{ error }}
  </NAlert>
  <section class="section">
    <div class="section-head">
      <h2>运行与恢复</h2>
      <div class="toolbar">
        <NButton :disabled="loading" @click="confirm('检查遗漏窗口', api.reconcile)">
          <template #icon>
            <ListChecks :size="16" />
          </template>检查遗漏窗口
        </NButton><NButton type="primary" :disabled="loading || !plans.length" @click="open()">
          <template #icon>
            <Play :size="16" />
          </template>触发运行
        </NButton>
      </div>
    </div>
    <div class="toolbar">
      <NSelect
        v-model:value="planFilter"
        :options="planOptions"
        placeholder="全部计划"
        :input-props="{ 'aria-label': '筛选计划' }"
        filterable
        clearable
        :disabled="loading"
        @update:value="run(loadRuns)"
      /><NInput
        v-model:value="filter"
        placeholder="筛选来源"
        :input-props="{ 'aria-label': '筛选来源' }"
        clearable
      />
    </div>
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane
        name="executions"
        tab="执行记录"
        :tab-props="tabProps('executions')"
        v-bind="panelProps('executions')"
      >
        <DataGrid
          :rows="visibleExecutions"
          :columns="executionColumns"
          :loading="loading"
          :actions="actions"
        />
      </NTabPane>
      <NTabPane
        name="windows"
        tab="交付窗口"
        :tab-props="tabProps('windows')"
        v-bind="panelProps('windows')"
      >
        <DataGrid :rows="visibleWindows" :columns="windowColumns" :loading="loading" />
      </NTabPane>
    </NTabs>
  </section>
  <NModal
    v-model:show="modal"
    preset="card"
    class="action-modal"
    :title="schemaReview ? '确认结构变更' : '触发运行'"
    :mask-closable="!loading"
    :closable="!loading"
  >
    <NAlert v-if="error" type="error" class="section-gap">
      {{ error }}
    </NAlert>
    <template v-if="schemaReview">
      <NCode
        :code="JSON.stringify(schemaReview.result?.schemaChange, null, 2)"
        word-wrap
        internal-no-highlight
        class="section-gap"
      /><ReasonForm label="确认理由" :busy="loading" @submit="approve" />
    </template>
    <TriggerForm
      v-else
      :plans="plans"
      :selected="null"
      :busy="loading"
      @submit="trigger"
    />
  </NModal>
  <DetailDrawer v-model:show="showDetail" title="执行详情" :value="detail" />
</template>
