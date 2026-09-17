<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NModal,
  NSpace,
  NTag,
} from 'naive-ui';
import { api, type Page } from '@/api';
import { useProjectStore } from '@/stores/project';
import AppJsonBlock from '@/components/AppJsonBlock.vue';
import AppPager from '@/components/AppPager.vue';
const project = useProjectStore();
const projectId = computed(() => project.selected?.id ?? 0);
interface Asset {
  id: string;
  source_code: string;
  name: string;
  kind: string;
  state: string;
  row_count: number;
  byte_count: number;
  data_window: string;
  available: boolean;
}
const rows = ref<Asset[]>([]),
  q = ref(''),
  page = ref(1),
  total = ref(0),
  busy = ref(false),
  error = ref(''),
  detail = ref<Record<string, any> | null>(null),
  show = ref(false);
const columns = [
  {
    title: '对象',
    key: 'name',
    render: (r: Asset) => h(NButton, { text: true, type: 'primary', onClick: () => inspect(r) }, () => r.name),
  },
  { title: '来源', key: 'source_code' },
  { title: '类型', key: 'kind' },
  { title: '状态', key: 'state' },
  { title: '行数', key: 'row_count' },
  { title: '业务窗口', key: 'data_window' },
  { title: '可作模型输入', key: 'available', render: (r: Asset) => (r.available ? '是' : '尚未完成') },
];
let generation = 0;
async function load() {
  const current = ++generation;
  busy.value = true;
  error.value = '';
  try {
    const result = await api<Page<Asset>>(
      `/warehouse/catalog/projects/${projectId.value}/assets?q=${encodeURIComponent(q.value)}&limit=25&offset=${(page.value - 1) * 25}`,
    );
    if (current === generation) {
      rows.value = result.items;
      total.value = result.total;
    }
  } catch (e) {
    if (current === generation) error.value = (e as Error).message;
  } finally {
    if (current === generation) busy.value = false;
  }
}
async function inspect(row: Asset) {
  try {
    detail.value = await api(`/warehouse/projects/${projectId.value}/assets/${row.id}`);
    show.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(
  () => projectId.value,
  () => {
    page.value = 1;
    detail.value = null;
    void load();
  },
  { immediate: true },
);
watch(page, () => void load());
</script>
<template>
  <n-card title="原始资产及版本"
    ><n-space class="gap"
      ><n-input
        v-model:value="q"
        placeholder="按对象或来源编码搜索"
        @keyup.enter="
          page = 1;
          load();
        "
      /><n-button
        @click="
          page = 1;
          load();
        "
        >搜索</n-button
      ><n-tag>{{ total }} 个资产版本</n-tag></n-space
    ><n-alert v-if="error" type="error" class="gap">{{ error }}</n-alert
    ><n-data-table :columns="columns" :data="rows" :loading="busy" :row-key="(r) => r.id" /><AppPager
      v-model:page="page"
      :item-count="total"
  /></n-card>
  <n-modal v-model:show="show" preset="card" :title="detail?.name" style="width: min(900px, 96vw)"
    ><n-descriptions bordered :column="2"
      ><n-descriptions-item label="来源">{{ detail?.source_code }}</n-descriptions-item
      ><n-descriptions-item label="状态">{{ detail?.state }}</n-descriptions-item
      ><n-descriptions-item label="行数">{{ detail?.row_count }}</n-descriptions-item
      ><n-descriptions-item label="大小（字节）">{{ detail?.byte_count }}</n-descriptions-item></n-descriptions
    >
    <h3>字段与结构</h3>
    <AppJsonBlock :value="detail?.schema" />
    <h3>版本与追溯信息</h3>
    <AppJsonBlock :value="{ ...detail, schema: undefined }" />
  </n-modal>
</template>
