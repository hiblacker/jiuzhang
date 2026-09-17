<script setup lang="ts">
import { computed, h, ref } from 'vue';
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
import { api } from '@/api';
import { usePagedQuery } from '@/composables/usePagedQuery';
import { useAsync } from '@/composables/useAsync';
import { useProjectStore } from '@/stores/project';
import AppJsonBlock from '@/components/AppJsonBlock.vue';
import AppPager from '@/components/AppPager.vue';

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
interface AssetDetail extends Asset {
  schema?: unknown;
}

const project = useProjectStore();
const projectId = computed(() => project.selected?.id ?? 0);
const { rows, query, page, total, loading, listError, search } = usePagedQuery<Asset>({
  route: ({ page, query, limit }) =>
    `/warehouse/catalog/projects/${projectId.value}/assets?q=${encodeURIComponent(query)}&limit=${limit}&offset=${(page - 1) * limit}`,
  resetKey: () => projectId.value,
});
const detail = ref<AssetDetail | null>(null);
const show = ref(false);
const inspect = useAsync();

const columns = [
  {
    title: '对象',
    key: 'name',
    render: (row: Asset) => h(NButton, { text: true, type: 'primary', onClick: () => void open(row) }, () => row.name),
  },
  { title: '来源', key: 'source_code' },
  { title: '类型', key: 'kind' },
  { title: '状态', key: 'state' },
  { title: '行数', key: 'row_count' },
  { title: '业务窗口', key: 'data_window' },
  { title: '可作模型输入', key: 'available', render: (row: Asset) => (row.available ? '是' : '尚未完成') },
];

async function open(row: Asset) {
  const loaded = await inspect.run(() => api<AssetDetail>(`/warehouse/projects/${projectId.value}/assets/${row.id}`));
  if (!loaded) return;
  detail.value = loaded;
  show.value = true;
}
</script>

<template>
  <n-card title="原始资产及版本">
    <n-space class="gap">
      <n-input v-model:value="query" placeholder="按对象或来源编码搜索" @keyup.enter="search()" />
      <n-button @click="search()">搜索</n-button>
      <n-tag>{{ total }} 个资产版本</n-tag>
    </n-space>
    <n-alert v-if="listError || inspect.error" type="error" class="gap">
      {{ listError || inspect.error }}
    </n-alert>
    <n-data-table :columns="columns" :data="rows" :loading="loading" :row-key="(row: Asset) => row.id" />
    <AppPager v-model:page="page" :item-count="total" />
  </n-card>
  <n-modal v-model:show="show" preset="card" :title="detail?.name" style="width: min(900px, 96vw)">
    <n-descriptions bordered :column="2">
      <n-descriptions-item label="来源">{{ detail?.source_code }}</n-descriptions-item>
      <n-descriptions-item label="状态">{{ detail?.state }}</n-descriptions-item>
      <n-descriptions-item label="行数">{{ detail?.row_count }}</n-descriptions-item>
      <n-descriptions-item label="大小（字节）">{{ detail?.byte_count }}</n-descriptions-item>
    </n-descriptions>
    <h3>字段与结构</h3>
    <AppJsonBlock :value="detail?.schema" />
    <h3>版本与追溯信息</h3>
    <AppJsonBlock :value="{ ...detail, schema: undefined }" />
  </n-modal>
</template>
