<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import {
  NAlert,
  NButton,
  NInput,
  NModal,
  NSelect,
  NTabs,
  NTabPane,
  NCode,
  useDialog,
  useMessage,
} from 'naive-ui'
import { Plus, Play, ListChecks, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useApi } from '../api'
import { useTabs } from '../tabs'
import {
  object,
  today,
  type Action,
  type Field,
  type Page,
  type Plan,
  type Row,
  type Source,
} from '../types'
import DataGrid from '../components/DataGrid.vue'
import ActionForm from '../components/ActionForm.vue'
import DetailDrawer from '../components/DetailDrawer.vue'
const props = defineProps<{ view: string }>()
const { activeTab, tabProps, panelProps } = useTabs('executions')
const { loading, error, run, call } = useApi()
const message = useMessage()
const dialog = useDialog()
onScopeDispose(() => dialog.destroyAll())
const sources = ref<Source[]>([])
const plans = ref<Plan[]>([])
const executions = ref<Row[]>([])
const windows = ref<Row[]>([])
const sourcePage = ref(0)
const pageSources = ref<Source[]>([])
const filter = ref('')
const planFilter = ref<number | null>(null)
const modal = ref(false)
const modalTitle = ref('')
const fields = ref<Field[]>([])
const initial = ref<Row>({})
const context = ref<Row | null>(null)
const detail = ref<unknown>()
const detailTitle = ref('详情')
const showDetail = ref(false)
let submitAction: (values: Row) => Promise<unknown> = async () => undefined
const visiblePlans = computed(() =>
  plans.value.filter(p => !filter.value || p.source_code.includes(filter.value)),
)
const visibleExecutions = computed(() =>
  executions.value.filter(p => !filter.value || String(p.source_code).includes(filter.value)),
)
const visibleWindows = computed(() =>
  windows.value.filter(p => !filter.value || String(p.source_code).includes(filter.value)),
)
async function allSources() {
  const rows: Source[] = []
  for (let offset = 0; offset <= 100000; offset += 100) {
    const page = await call<Page<Source>>(`sources?limit=100&offset=${offset}`)
    rows.push(...page.items)
    if (page.items.length < 100) {
      break
    }
  }
  sources.value = rows
}
async function loadSources(page = sourcePage.value) {
  const value = await call<Page<Source>>(`sources?limit=50&offset=${page * 50}`)
  pageSources.value = value.items
  sourcePage.value = page
}
async function loadRuns() {
  const q = planFilter.value ? `?planId=${planFilter.value}` : ''
  const result = await Promise.all([
    call<Row[]>(`lake/executions${q}`),
    call<Row[]>(`lake/windows${q}`),
  ])
  ;[executions.value, windows.value] = result
}
async function load() {
  if (props.view === 'sources') {
    await loadSources()
  }
  else {
    plans.value = await call<Plan[]>('lake/plans')
    if (props.view === 'plans') {
      await allSources()
    }
    else {
      await loadRuns()
    }
  }
}
function open(
  title: string,
  items: Field[],
  value: Row,
  action: (v: Row) => Promise<unknown>,
  evidence: Row | null = null,
) {
  modalTitle.value = title
  fields.value = items
  initial.value = value
  submitAction = action
  context.value = evidence
  modal.value = true
}
async function save(values: Row) {
  await run(async () => {
    await submitAction(values)
    modal.value = false
    message.success('操作已提交')
    await load()
  })
}
function mutate(title: string, route: string, body: Row) {
  dialog.warning({
    title,
    content: '确认执行此操作？',
    positiveText: '确认',
    negativeText: '返回',
    onPositiveClick: () =>
      run(async () => {
        await call(route, body)
        message.success('操作已提交')
        await load()
      }),
  })
}
function newSource() {
  open(
    '登记来源',
    [
      { key: 'code', label: '来源编码', required: true },
      {
        key: 'sourceType',
        label: '来源类型',
        type: 'select',
        options: ['MYSQL', 'FILE', 'REST'].map(value => ({ label: value, value })),
        required: true,
      },
      { key: 'credentialRef', label: '凭证引用', required: true },
      { key: 'config', label: '来源配置', type: 'json' },
    ],
    { sourceType: 'MYSQL', config: {} },
    value => call('sources', value),
  )
}
function planForm(plan?: Plan) {
  const fields: Field[] = [
    {
      key: 'sourceCode',
      label: '来源',
      type: 'select',
      required: true,
      disabled: !!plan,
      options: sources.value.map(s => ({ label: s.code, value: s.code })),
    },
    {
      key: 'kind',
      label: '接入方式',
      type: 'select',
      required: true,
      options: [
        { label: '数据库全量快照', value: 'MYSQL_SNAPSHOT' },
        { label: '目录文件', value: 'FILE_SCAN' },
        { label: 'REST API', value: 'REST_PULL' },
      ],
    },
    { key: 'runtimeRef', label: '执行配置名', required: true },
    { key: 'inventoryVersion', label: '数据库清单版本', type: 'number', min: 1 },
    { key: 'startDate', label: '开始日期', type: 'date', required: true },
    { key: 'triggerTime', label: '每日触发时间', type: 'time', required: true },
    {
      key: 'timezone',
      label: '时区',
      type: 'select',
      options: ['Asia/Shanghai', 'UTC'].map(value => ({ label: value, value })),
    },
    { key: 'maxAttempts', label: '最多尝试次数', type: 'number', min: 1, max: 8, required: true },
    {
      key: 'timeoutSeconds',
      label: '运行上限（秒）',
      type: 'number',
      min: 30,
      max: 86400,
      required: true,
    },
    { key: 'historicalRead', label: '来源允许重读过去日期', type: 'switch' },
    { key: 'contract', label: '交付契约', type: 'json' },
  ]
  const defaults: Row = plan
    ? {
        sourceCode: plan.source_code,
        kind: plan.kind,
        runtimeRef: plan.runtime_ref,
        inventoryVersion: plan.inventory_version,
        startDate: plan.start_date,
        triggerTime: plan.trigger_time,
        timezone: plan.timezone,
        maxAttempts: plan.max_attempts,
        timeoutSeconds: plan.timeout_seconds,
        historicalRead: plan.historical_read,
        contract: plan.contract,
      }
    : {
        kind: 'MYSQL_SNAPSHOT',
        startDate: today(),
        triggerTime: '02:00',
        timezone: 'Asia/Shanghai',
        maxAttempts: 3,
        timeoutSeconds: 3600,
        contract: {},
      }
  open(plan ? `修改计划 · ${plan.source_code}` : '新建计划', fields, defaults, (value) => {
    if (value.kind === 'MYSQL_SNAPSHOT' && !value.inventoryVersion) {
      throw new Error('数据库计划必须指定清单版本')
    }
    return call('lake/plans', {
      ...value,
      expectedVersion:
        plan?.active_version
        ?? plans.value.find(p => p.source_code === value.sourceCode)?.active_version
        ?? 0,
      triggerTime:
        String(value.triggerTime).length === 5 ? `${value.triggerTime}:00` : value.triggerTime,
    })
  })
}
function trigger(plan?: Plan) {
  open(
    '触发运行',
    [
      {
        key: 'plan',
        label: '计划',
        type: 'select',
        required: true,
        options: plans.value.map(p => ({
          label: `${p.source_code} · v${p.active_version}`,
          value: p.id,
        })),
      },
      { key: 'day', label: '业务日期', type: 'date', required: true },
      { key: 'reason', label: '触发原因', required: true },
      { key: 'revision', label: '生成新修订', type: 'switch' },
    ],
    { plan: plan?.id, day: today(), reason: '手工触发', revision: false },
    ({ plan: id, ...body }) => call(`lake/plans/${id}/trigger`, body),
  )
}
function inspect(row: Row) {
  detail.value = row
  detailTitle.value = '执行详情'
  showDetail.value = true
}
function executionActions(row: Row): Action[] {
  const actions: Action[] = [{ label: '详情', run: () => inspect(row) }]
  if (['FAILED', 'INCOMPLETE', 'CANCELLED'].includes(String(row.state))) {
    actions.push({
      label: '重试',
      run: () => mutate('重试执行', `lake/executions/${row.id}/retry`, {}),
    })
  }
  if (['QUEUED', 'RUNNING'].includes(String(row.state))) {
    actions.push({
      label: '取消',
      danger: true,
      run: () => mutate('取消执行', `lake/executions/${row.id}/cancel`, {}),
    })
  }
  const result = object(row.result)
  const assets = Array.isArray(result.assets) ? (result.assets as Row[]) : []
  if (
    ['COMPLETE', 'FAILED'].includes(String(row.state))
    && (assets.some(a => ['FILE', 'API'].includes(String(a.kind)))
      || (row.error_code === 'LEASE_EXPIRED' && ['FILE_SCAN', 'REST_PULL'].includes(String(row.kind))))
  ) {
    actions.push({
      label: '重解析原件',
      run: () => mutate('重解析原件', `lake/executions/${row.id}/reprocess`, {}),
    })
  }
  if (row.error_code === 'SCHEMA_CHANGE_REVIEW_REQUIRED' && result.schemaChange) {
    actions.push({
      label: '确认结构变更',
      run: () =>
        open(
          '确认结构变更',
          [{ key: 'reason', label: '确认理由', type: 'textarea', required: true }],
          {},
          v => call(`lake/executions/${row.id}/approve-schema`, v),
          object(result.schemaChange),
        ),
    })
  }
  return actions
}
onMounted(() => run(load))
</script>
<template>
  <NAlert v-if="error" type="error" class="section-gap">
    {{ error }}
  </NAlert>
  <section v-if="view === 'sources'" class="section">
    <div class="section-head">
      <h2>已登记来源</h2>
      <NButton type="primary" :disabled="loading" @click="newSource">
        <template #icon>
          <Plus :size="16" />
        </template>登记来源
      </NButton>
    </div>
    <DataGrid
      :rows="pageSources"
      :loading="loading"
      :paginated="false"
      :columns="[
        { key: 'code', title: '来源编码', width: 230 },
        { key: 'sourceType', title: '类型' },
        { key: 'state', title: '状态', state: true },
        { key: 'createdAt', title: '创建时间', width: 230 },
      ]"
    />
    <div class="pager">
      <span class="muted">第 {{ sourcePage + 1 }} 页</span><NButton
        :disabled="loading || sourcePage === 0"
        @click="run(() => loadSources(sourcePage - 1))"
      >
        <template #icon>
          <ChevronLeft :size="16" />
        </template>上一页
      </NButton><NButton
        :disabled="loading || pageSources.length < 50"
        @click="run(() => loadSources(sourcePage + 1))"
      >
        下一页<template #icon>
          <ChevronRight :size="16" />
        </template>
      </NButton>
    </div>
  </section>
  <section v-else-if="view === 'plans'" class="section">
    <div class="section-head">
      <h2>持续入湖计划</h2>
      <NButton type="primary" :disabled="loading || !sources.length" @click="planForm()">
        <template #icon>
          <Plus :size="16" />
        </template>新建计划
      </NButton>
    </div>
    <div class="toolbar">
      <NInput
        v-model:value="filter"
        placeholder="筛选来源"
        :input-props="{ 'aria-label': '筛选来源' }"
        clearable
      />
    </div>
    <DataGrid
      :rows="visiblePlans"
      :loading="loading"
      :columns="[
        { key: 'source_code', title: '来源', width: 190 },
        { key: 'active_version', title: '版本', width: 75 },
        { key: 'kind', title: '接入方式', width: 190 },
        { key: 'trigger_time', title: '触发时间', width: 110 },
        { key: 'timezone', title: '时区' },
        { key: 'state', title: '状态', state: true, width: 110 },
      ]"
      :actions="
        (row) => [
          { label: '修改', run: () => planForm(row as Plan) },
          {
            label: row.state === 'ACTIVE' ? '暂停' : '恢复',
            run: () =>
              mutate(
                row.state === 'ACTIVE' ? '暂停计划' : '恢复计划',
                `lake/plans/${row.id}/state`,
                { state: row.state === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' },
              ),
          },
          { label: '触发', run: () => trigger(row as Plan) },
        ]
      "
    />
  </section>
  <section v-else class="section">
    <div class="section-head">
      <h2>运行与恢复</h2>
      <div class="toolbar">
        <NButton :disabled="loading" @click="mutate('检查遗漏窗口', 'lake/calendar/reconcile', {})">
          <template #icon>
            <ListChecks :size="16" />
          </template>检查遗漏窗口
        </NButton><NButton type="primary" :disabled="loading || !plans.length" @click="trigger()">
          <template #icon>
            <Play :size="16" />
          </template>触发运行
        </NButton>
      </div>
    </div>
    <div class="toolbar">
      <NSelect
        v-model:value="planFilter"
        :options="plans.map((p) => ({ label: p.source_code, value: p.id }))"
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
          :loading="loading"
          :columns="[
            { key: 'id', title: '执行', width: 75 },
            { key: 'source_code', title: '来源' },
            { key: 'business_date', title: '业务日期', width: 120 },
            { key: 'attempt', title: '尝试', width: 70 },
            { key: 'state', title: '状态', state: true },
            { key: 'error_code', title: '错误', width: 250 },
          ]"
          :actions="executionActions"
        />
      </NTabPane>
      <NTabPane
        name="windows"
        tab="交付窗口"
        :tab-props="tabProps('windows')"
        v-bind="panelProps('windows')"
      >
        <DataGrid
          :rows="visibleWindows"
          :loading="loading"
          :columns="[
            { key: 'source_code', title: '来源' },
            { key: 'business_date', title: '日期' },
            { key: 'revision', title: '修订', width: 80 },
            { key: 'state', title: '状态', state: true },
            { key: 'reason', title: '说明', width: 300 },
          ]"
        />
      </NTabPane>
    </NTabs>
  </section>
  <NModal
    v-model:show="modal"
    preset="card"
    class="action-modal"
    :title="modalTitle"
    :mask-closable="!loading"
    :closable="!loading"
  >
    <NAlert v-if="error" type="error" class="section-gap">
      {{ error }}
    </NAlert>
    <NCode
      v-if="context"
      :code="JSON.stringify(context, null, 2)"
      word-wrap
      internal-no-highlight
      class="section-gap"
    />
    <ActionForm
      :key="modalTitle + JSON.stringify(initial)"
      :fields="fields"
      :initial="initial"
      :busy="loading"
      submit-label="确认提交"
      @submit="save"
    />
  </NModal>
  <DetailDrawer v-model:show="showDetail" :title="detailTitle" :value="detail" />
</template>
