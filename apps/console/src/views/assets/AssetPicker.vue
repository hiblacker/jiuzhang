<script setup lang="ts">
import { h, ref, watch } from 'vue';
import { NAlert, NButton, NDataTable, NInput, NPagination, NSpace } from 'naive-ui';
import { api, type Page } from '@/api';
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
const q = ref(props.object || ''),
  page = ref(1),
  rows = ref<PickedAsset[]>([]),
  total = ref(0),
  error = ref(''),
  busy = ref(false);
const columns = [
  { title: '来源', key: 'source_code' },
  { title: '对象', key: 'name' },
  { title: '业务窗口', key: 'data_window' },
  { title: '批次', key: 'run_id' },
  { title: '行数', key: 'row_count' },
  {
    title: '选择版本',
    key: 'action',
    render: (r: PickedAsset) =>
      h(
        NButton,
        {
          size: 'small',
          disabled:
            !r.available ||
            (!!props.source && r.source_code !== props.source) ||
            (!!props.object && r.name !== props.object),
          onClick: () => emit('select', r),
        },
        () => (r.available ? '选择' : '未完成'),
      ),
  },
];
let generation = 0;
async function load() {
  const current = ++generation;
  busy.value = true;
  error.value = '';
  try {
    const result = await api<Page<PickedAsset>>(
      `/warehouse/catalog/projects/${props.project}/assets?q=${encodeURIComponent(q.value)}&limit=25&offset=${(page.value - 1) * 25}`,
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
watch(
  () => [props.project, props.source, props.object],
  () => {
    page.value = 1;
    q.value = props.object || '';
    void load();
  },
  { immediate: true },
);
watch(page, () => void load());
</script>
<template>
  <n-space class="gap"
    ><n-input
      v-model:value="q"
      placeholder="按对象或来源搜索"
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
    ></n-space
  ><n-alert v-if="error" type="error">{{ error }}</n-alert
  ><n-data-table :columns="columns" :data="rows" :loading="busy" :row-key="(r) => r.id" /><n-pagination
    v-model:page="page"
    :item-count="total"
    :page-size="25"
    class="gap"
  />
</template>
