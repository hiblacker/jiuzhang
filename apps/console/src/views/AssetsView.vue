<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { NAlert, NButton, NEmpty } from 'naive-ui';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { projectId, useApi } from '../api';
import type { Row } from '../types';
import DataGrid from '../components/DataGrid.vue';
import DetailDrawer from '../components/DetailDrawer.vue';
const { loading, error, run, call } = useApi();
const project = projectId.value;
const rows = ref<Row[]>([]),
  offset = ref(0),
  detail = ref<unknown>(),
  showDetail = ref(false),
  title = ref('资产详情');
async function load(next = 0) {
  if (project)
    await run(async () => {
      rows.value = await call<Row[]>(`warehouse/projects/${project}/assets?limit=100&offset=${next}`);
      offset.value = next;
    });
}
function inspect(row: Row, coverage = false) {
  void run(async () => {
    detail.value = await call(
      `warehouse/projects/${project}/${coverage ? `coverage/${row.run_id}` : `assets/${encodeURIComponent(String(row.id))}`}`,
    );
    title.value = coverage ? '批次覆盖' : '结构与来源';
    showDetail.value = true;
  });
}
onMounted(() => load());
</script>
<template>
  <n-alert v-if="error" type="error" class="section-gap">{{ error }}</n-alert>
  <n-empty v-if="!project" description="暂无可访问的项目" />
  <section v-else class="section">
    <div class="section-head">
      <h2>资产版本</h2>
      <span class="muted">{{ rows.length }} 条 / 第 {{ offset / 100 + 1 }} 页</span>
    </div>
    <DataGrid
      :rows="rows"
      :loading="loading"
      :paginated="false"
      :columns="[
        { key: 'name', title: '资产名称', width: 210 },
        { key: 'source_code', title: '来源' },
        { key: 'kind', title: '类型', width: 100 },
        { key: 'state', title: '状态', state: true },
        { key: 'row_count', title: '行数', width: 100 },
        { key: 'data_window', title: '窗口', width: 220 },
        { key: 'contract_version', title: '契约版本', width: 100 },
      ]"
      :actions="
        (row) => [
          { label: '结构与来源', run: () => inspect(row) },
          ...(row.kind === 'TABLE' ? [{ label: '批次覆盖', run: () => inspect(row, true) }] : []),
        ]
      "
    />
    <div class="pager">
      <n-button :disabled="loading || offset === 0" @click="load(offset - 100)"
        ><template #icon><ChevronLeft :size="16" /></template>上一页</n-button
      ><n-button :disabled="loading || rows.length < 100 || offset >= 1000000" @click="load(offset + 100)"
        >下一页<template #icon><ChevronRight :size="16" /></template
      ></n-button>
    </div>
  </section>
  <DetailDrawer v-model:show="showDetail" :title="title" :value="detail" />
</template>
