<script setup lang="ts">
import { ref } from 'vue';
import { NAlert, NButton, NDataTable, NInput, NModal, NSelect, NSpace } from 'naive-ui';
import { api } from '@/api';
export interface OperationTarget {
  type: 'system' | 'instance' | 'connection' | 'channel';
  id: number;
  expectedVersion: number;
}
const props = defineProps<{ project: number; targets: OperationTarget[] }>();
const emit = defineEmits<{ changed: [] }>();
const action = ref('PAUSE'),
  reason = ref(''),
  show = ref(false),
  error = ref(''),
  busy = ref(false);
const preview = ref<{
  id: string;
  items: {
    type: string;
    id: number;
    eligible?: boolean;
    success?: boolean;
    errorCode?: string;
    impact?: { sourceIds: number[]; runningCount: number; datasets: { name: string }[] };
  }[];
} | null>(null);
const executed = ref(false);
const columns = [
  { title: '对象类型', key: 'type' },
  { title: '对象 ID', key: 'id' },
  {
    title: '通道 / 在途',
    key: 'impact',
    render: (r: any) => (r.impact ? `${r.impact.sourceIds.length} / ${r.impact.runningCount}` : '—'),
  },
  {
    title: '受影响数据集',
    key: 'datasets',
    render: (r: any) => r.impact?.datasets.map((d: any) => d.name).join('、') || '无',
  },
  {
    title: '结果',
    key: 'result',
    render: (r: any) => r.errorCode || (r.success ? '已完成' : r.eligible ? '可执行' : '不可执行'),
  },
];
async function inspect() {
  busy.value = true;
  error.value = '';
  try {
    preview.value = await api(`/warehouse/projects/${props.project}/ingestion-operations/preview`, {
      action: action.value,
      reason: reason.value,
      targets: props.targets,
    });
    show.value = true;
    executed.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function execute() {
  if (!preview.value) return;
  busy.value = true;
  error.value = '';
  try {
    preview.value = await api(
      `/warehouse/projects/${props.project}/ingestion-operations/${preview.value.id}/execute`,
      {},
    );
    executed.value = true;
    emit('changed');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <n-space class="gap" align="center"
    ><n-select
      v-model:value="action"
      :options="[
        { label: '暂停', value: 'PAUSE' },
        { label: '恢复', value: 'RESUME' },
        { label: '退役', value: 'RETIRE' },
        ...(targets.every((t) => t.type === 'channel')
          ? [
              { label: '重试最近任务', value: 'RETRY' },
              { label: '取消最近任务', value: 'CANCEL' },
            ]
          : []),
      ]"
      style="width: 150px"
    /><n-input v-model:value="reason" placeholder="操作原因" maxlength="300" style="width: 240px" /><n-button
      :loading="busy"
      :disabled="!targets.length || !reason.trim()"
      @click="inspect"
      >预览 {{ targets.length }} 项操作</n-button
    ></n-space
  >
  <n-alert v-if="error" type="error" class="gap">{{ error }}</n-alert>
  <n-modal v-model:show="show" preset="card" title="核对操作影响" style="width: min(960px, 96vw)">
    <p>暂停允许已领取的任务完成；需要终止时使用取消。退役保留原件和历史发布，有下游依赖或在途执行时会拒绝。</p>
    <n-data-table :columns="columns" :data="preview?.items || []" />
    <n-alert v-if="error" type="error" class="gap">{{ error }}</n-alert>
    <n-button class="gap" type="primary" :disabled="executed" :loading="busy" @click="execute">{{
      executed ? '操作已返回逐项结果' : '确认执行已预览的目标'
    }}</n-button>
  </n-modal>
</template>
