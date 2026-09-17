<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NAlert, NButton, NInput } from 'naive-ui';
import { Activity, CheckCircle2, Database, CircleAlert, Search } from 'lucide-vue-next';
import { useApi } from '../api';
import { display, object, type Row } from '../types';
import DataGrid from '../components/DataGrid.vue';
import DetailDrawer from '../components/DetailDrawer.vue';
const { loading, error, run, call } = useApi();
const summary = ref<Row>({}),
  runs = ref<Row[]>([]),
  deliveries = ref<Row[]>([]),
  source = ref('');
const detail = ref<unknown>(),
  showDetail = ref(false);
const stats = computed(() => [
  { label: '系统运行', value: object(summary.value.runs).run_count, icon: Activity },
  { label: '完成运行', value: object(summary.value.runs).complete_count, icon: CheckCircle2 },
  { label: '原始对象行数', value: object(summary.value.objects).row_count, icon: Database },
  { label: '失败对象', value: object(summary.value.objects).failed_object_count, icon: CircleAlert },
]);
async function load() {
  await run(async () => {
    const q = source.value.trim() ? `sourceCode=${encodeURIComponent(source.value.trim())}&` : '';
    const values = await Promise.all([
      call<Row>(`lake/summary?${q}`),
      call<Row[]>(`lake/runs?${q}limit=50`),
      call<Row[]>(`lake/deliveries?${q}limit=50`),
    ]);
    [summary.value, runs.value, deliveries.value] = values;
  });
}
function inspect(row: Row) {
  detail.value = row;
  showDetail.value = true;
}
onMounted(load);
</script>
<template>
  <n-alert v-if="error" type="error">{{ error }}</n-alert>
  <form class="toolbar" @submit.prevent="load">
    <n-input
      v-model:value="source"
      placeholder="来源编码"
      :input-props="{ 'aria-label': '筛选来源编码' }"
      clearable
    /><n-button attr-type="submit" :loading="loading"
      ><template #icon><Search :size="16" /></template>筛选</n-button
    >
  </form>
  <div class="stats">
    <div v-for="stat in stats" :key="stat.label" class="stat">
      <div class="stat-label"><component :is="stat.icon" :size="15" />{{ stat.label }}</div>
      <div class="stat-value">
        {{ typeof stat.value === 'number' ? stat.value.toLocaleString('zh-CN') : display(stat.value) }}
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
