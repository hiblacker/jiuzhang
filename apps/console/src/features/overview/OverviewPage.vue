<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NAlert, NButton, NInput } from 'naive-ui'
import { Activity, CheckCircle2, Database, CircleAlert, Search } from 'lucide-vue-next'
import { useApi } from '../../shared/composables/useApi'
import { display } from '../../shared/types'
import { overviewApi } from './api'
import type { Summary, SystemRun, Delivery } from './api'
import DataGrid from '../../shared/components/DataGrid.vue'
import DetailDrawer from '../../shared/components/DetailDrawer.vue'
const { loading, error, run, call } = useApi()
const api = overviewApi(call)
const summary = ref<Summary>({})
const runs = ref<SystemRun[]>([])
const deliveries = ref<Delivery[]>([])
const source = ref('')
const detail = ref<unknown>()
const showDetail = ref(false)
const stats = computed(() => [
  { label: '系统运行', value: summary.value.runs?.run_count, icon: Activity },
  { label: '完成运行', value: summary.value.runs?.complete_count, icon: CheckCircle2 },
  { label: '原始对象行数', value: summary.value.objects?.row_count, icon: Database },
  {
    label: '失败对象',
    value: summary.value.objects?.failed_object_count,
    icon: CircleAlert,
  },
])
async function load() {
  await run(async () => {
    const data = await api.load(source.value)
    summary.value = data.summary
    runs.value = data.runs
    deliveries.value = data.deliveries
  })
}
function inspect(row: SystemRun) {
  detail.value = row
  showDetail.value = true
}
onMounted(load)
</script>
<template>
  <NAlert v-if="error" type="error">
    {{ error }}
  </NAlert>
  <form class="toolbar" @submit.prevent="load">
    <NInput
      v-model:value="source"
      placeholder="来源编码"
      :input-props="{ 'aria-label': '筛选来源编码' }"
      clearable
    /><NButton attr-type="submit" :loading="loading">
      <template #icon>
        <Search :size="16" />
      </template>筛选
    </NButton>
  </form>
  <div class="stats">
    <div v-for="stat in stats" :key="stat.label" class="stat">
      <div class="stat-label">
        <component :is="stat.icon" :size="15" />{{ stat.label }}
      </div>
      <div class="stat-value">
        {{
          typeof stat.value === 'number' ? stat.value.toLocaleString('zh-CN') : display(stat.value)
        }}
      </div>
    </div>
  </div>
  <section class="section">
    <div class="section-head">
      <h2>最近系统运行</h2>
      <span class="muted">最近 50 条</span>
    </div>
    <DataGrid
      :rows="runs"
      :loading="loading"
      :columns="[
        { key: 'source_code', title: '来源' },
        { key: 'mode', title: '模式' },
        { key: 'scheduled_window_start', title: '窗口', width: 230 },
        { key: 'state', title: '状态', state: true },
        { key: 'error_code', title: '错误' },
      ]"
      :actions="(row) => [{ label: '详情', run: () => inspect(row) }]"
    />
  </section>
  <section class="section">
    <div class="section-head">
      <h2>每日交付账本</h2>
      <span class="muted">最近 50 条</span>
    </div>
    <DataGrid
      :rows="deliveries"
      :loading="loading"
      :columns="[
        { key: 'source_code', title: '来源' },
        { key: 'delivery_kind', title: '类型' },
        { key: 'scheduled_window_start', title: '窗口', width: 230 },
        { key: 'observed_state', title: '状态', state: true },
        { key: 'received_at', title: '接收时间', width: 230 },
      ]"
    />
  </section>
  <DetailDrawer v-model:show="showDetail" title="运行详情" :value="detail" />
</template>

<style scoped src="./OverviewPage.css" />
