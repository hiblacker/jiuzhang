<script setup lang="ts">
import { h, watch } from 'vue';
import { NAlert, NButton, NDataTable, NInput, NSpace } from 'naive-ui';
import AppPager from '@/components/AppPager.vue';
import { usePagedQuery } from '@/composables/usePagedQuery';
export interface PickedAsset {
  id: string;
  source_code: string;
  name: string;
  available: boolean;
  row_count: number;
  data_window: string;
  run_id: number;
}
const props = defineProps<{ project: number; source?: string; object?: string }>();
const emit = defineEmits<{ select: [PickedAsset] }>();
const { rows, query, page, total, loading, listError, search } = usePagedQuery<PickedAsset>({
  route: ({ page: current, query: text, limit }) =>
    `/warehouse/catalog/projects/${props.project}/assets?q=${encodeURIComponent(text)}&limit=${limit}&offset=${(current - 1) * limit}`,
  resetKey: () => [props.project, props.source, props.object],
});
watch(
  () => [props.project, props.source, props.object],
  () => {
    query.value = props.object || '';
    search();
  },
);
const columns = [
  { title: '来源', key: 'source_code' },
  { title: '对象', key: 'name' },
  { title: '业务窗口', key: 'data_window' },
  { title: '批次', key: 'run_id' },
  { title: '行数', key: 'row_count' },
  {
    title: '选择版本',
    key: 'action',
    render: (row: PickedAsset) =>
      h(
        NButton,
        {
          size: 'small',
          disabled:
            !row.available ||
            (!!props.source && row.source_code !== props.source) ||
            (!!props.object && row.name !== props.object),
          onClick: () => emit('select', row),
        },
        () => (row.available ? '选择' : '未完成'),
      ),
  },
];
</script>
<template>
  <n-space class="gap">
    <n-input v-model:value="query" placeholder="按对象或来源搜索" @keyup.enter="search()" />
    <n-button @click="search()">搜索</n-button>
  </n-space>
  <n-alert v-if="listError" type="error">{{ listError }}</n-alert>
  <n-data-table :columns="columns" :data="rows" :loading="loading" :row-key="(row: PickedAsset) => row.id" />
  <AppPager v-model:page="page" :item-count="total" />
</template>
