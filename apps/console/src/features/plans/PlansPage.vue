<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { NAlert, NButton, NInput, NModal, useDialog, useMessage } from 'naive-ui'
import { Plus } from 'lucide-vue-next'
import DataGrid from '../../shared/components/DataGrid.vue'
import { useApi } from '../../shared/composables/useApi'
import type { Action, Column, Plan, Source } from '../../shared/types'
import { sourceApi } from '../sources/api'
import { planApi } from './api'
import type { PlanInput, TriggerInput } from './api'
import PlanForm from './PlanForm.vue'
import TriggerForm from './TriggerForm.vue'
const { call, loading, error, run } = useApi()
const api = planApi(call)
const dialog = useDialog()
const message = useMessage()
onScopeDispose(() => dialog.destroyAll())
const plans = ref<Plan[]>([])
const sources = ref<Source[]>([])
const filter = ref('')
const modal = ref(false)
const triggering = ref(false)
const selected = ref<Plan | null>(null)
const title = computed(() =>
  triggering.value
    ? '触发运行'
    : selected.value
      ? `修改计划 · ${selected.value.source_code}`
      : '新建计划',
)
const visible = computed(() =>
  plans.value.filter(plan => plan.source_code.includes(filter.value)),
)
const columns: Column[] = [
  { key: 'source_code', title: '来源', width: 190 },
  { key: 'active_version', title: '版本', width: 75 },
  { key: 'kind', title: '接入方式', width: 190 },
  { key: 'trigger_time', title: '触发时间', width: 110 },
  { key: 'timezone', title: '时区' },
  { key: 'state', title: '状态', state: true, width: 110 },
]
async function load() {
  plans.value = await api.list()
  sources.value = await sourceApi(call).all()
}
function open(plan: Plan | null = null, trigger = false) {
  selected.value = plan
  triggering.value = trigger
  error.value = ''
  modal.value = true
}
function save(action: () => Promise<unknown>) {
  void run(async () => {
    await action()
    modal.value = false
    message.success('操作已提交')
    await load()
  })
}
function savePlan(input: PlanInput) {
  save(() => api.save(input))
}
function trigger(input: TriggerInput) {
  save(() => api.trigger(input))
}
function actions(plan: Plan): Action[] {
  const state = plan.state === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
  return [
    { label: '修改', run: () => open(plan) },
    {
      label: state === 'PAUSED' ? '暂停' : '恢复',
      run: () => {
        dialog.warning({
          title: state === 'PAUSED' ? '暂停计划' : '恢复计划',
          content: '确认执行此操作？',
          positiveText: '确认',
          negativeText: '返回',
          onPositiveClick: () =>
            run(async () => {
              await api.setState(plan.id, state)
              await load()
            }),
        })
      },
    },
    { label: '触发', run: () => open(plan, true) },
  ]
}
onMounted(() => run(load))
</script>
<template>
  <NAlert v-if="error && !modal" type="error" class="section-gap">
    {{ error }}
  </NAlert>
  <section class="section">
    <div class="section-head">
      <h2>持续入湖计划</h2>
      <NButton type="primary" :disabled="loading || !sources.length" @click="open()">
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
      :rows="visible"
      :columns="columns"
      :loading="loading"
      :actions="actions"
    />
  </section>
  <NModal
    v-model:show="modal"
    preset="card"
    class="action-modal"
    :title="title"
    :mask-closable="!loading"
    :closable="!loading"
  >
    <NAlert v-if="error" type="error" class="section-gap">
      {{ error }}
    </NAlert>
    <TriggerForm
      v-if="triggering"
      :plans="plans"
      :selected="selected?.id ?? null"
      :busy="loading"
      @submit="trigger"
    />
    <PlanForm
      v-else
      :plan="selected"
      :plans="plans"
      :sources="sources"
      :busy="loading"
      @submit="savePlan"
    />
  </NModal>
</template>
