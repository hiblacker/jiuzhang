<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NFormItem,
  NInput,
  NModal,
  NPagination,
  NSelect,
  NSpace,
  NTabPane,
  NTabs,
} from 'naive-ui';
import { api, type Page } from '@/api';
import { usePermissionStore } from '@/stores/permission';
import { useProjectStore } from '@/stores/project';
import { useSessionStore } from '@/stores/session';
const permission = usePermissionStore();
const project = useProjectStore();
const session = useSessionStore();
const projectId = computed(() => project.selected?.id ?? 0);
const canManage = computed(() => permission.canManage);
const canOperate = computed(() => permission.canOperate);
const identity = computed(() => session.identity?.identity ?? '');
const tab = ref('runs'),
  q = ref(''),
  state = ref(''),
  page = ref(1),
  total = ref(0),
  rows = ref<Record<string, any>[]>([]),
  error = ref(''),
  busy = ref(false),
  detail = ref<Record<string, any> | null>(null),
  visible = ref(false),
  reason = ref(''),
  owner = ref(identity.value);
const systemCode = ref(''),
  instanceCode = ref(''),
  connectionCode = ref(''),
  sourceCode = ref('');
const runColumns = [
  { title: '来源', key: 'name' },
  { title: '业务日期', key: 'business_date' },
  { title: '状态', key: 'state' },
  { title: '原因', key: 'error_code' },
  {
    title: '操作',
    key: 'actions',
    render: (r: any) => h(NButton, { text: true, onClick: () => inspect(r) }, () => '详情 / 处理'),
  },
];
const incidentColumns = [
  { title: '系统', key: 'system_name' },
  { title: '连接', key: 'connection_name' },
  { title: '来源', key: 'source_code' },
  { title: '数据集', key: 'dataset_name' },
  { title: '类别', key: 'category' },
  { title: '状态', key: 'state' },
  { title: '负责人', key: 'owner_identity' },
  {
    title: '操作',
    key: 'actions',
    render: (r: any) => h(NButton, { text: true, onClick: () => inspect(r) }, () => '观察与处置'),
  },
];
const auditColumns = [
  { title: '身份', key: 'actor' },
  { title: '操作', key: 'action' },
  { title: '发布', key: 'release_id' },
  { title: '权限版本', key: 'policy_revision' },
  { title: '返回行数', key: 'returned_rows' },
  { title: '耗时 ms', key: 'elapsed_ms' },
  { title: '结果', key: 'result' },
  { title: '请求 ID', key: 'request_id' },
];
let generation = 0;
async function load() {
  const current = ++generation;
  busy.value = true;
  error.value = '';
  try {
    const pagination = `limit=25&offset=${(page.value - 1) * 25}`;
    const route =
      tab.value === 'runs'
        ? `/warehouse/catalog/projects/${projectId.value}/runs?q=${encodeURIComponent(q.value)}&systemCode=${encodeURIComponent(systemCode.value)}&instanceCode=${encodeURIComponent(instanceCode.value)}&connectionCode=${encodeURIComponent(connectionCode.value)}&sourceCode=${encodeURIComponent(sourceCode.value)}&state=${state.value}&${pagination}`
        : tab.value === 'audit'
          ? `/warehouse/projects/${projectId.value}/query-audit?${pagination}`
          : `/warehouse/projects/${projectId.value}/incidents?q=${encodeURIComponent(q.value)}&state=${state.value}&${pagination}`;
    const result = await api<Page<Record<string, any>>>(route);
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
async function inspect(row: Record<string, any>) {
  error.value = '';
  try {
    detail.value = await api(
      `/warehouse/projects/${projectId.value}/${tab.value === 'runs' ? 'runs' : 'incidents'}/${row.id}`,
    );
    reason.value = '';
    owner.value = detail.value?.incident?.owner_identity || identity.value;
    visible.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function operate(action: string) {
  busy.value = true;
  error.value = '';
  try {
    await api(`/warehouse/projects/${projectId.value}/runs/${detail.value?.id}/${action}`, { reason: reason.value });
    visible.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function acknowledge() {
  busy.value = true;
  error.value = '';
  try {
    await api(`/warehouse/projects/${projectId.value}/incidents/${detail.value?.incident.id}/acknowledge`, {
      expectedRevision: detail.value?.incident.revision,
      ownerIdentity: owner.value,
      reason: reason.value,
    });
    visible.value = false;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function reconcile() {
  busy.value = true;
  error.value = '';
  try {
    await api(`/warehouse/projects/${projectId.value}/incidents/reconcile`, {});
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
watch(
  () => [projectId.value, tab.value],
  () => {
    page.value = 1;
    state.value = '';
    systemCode.value = '';
    instanceCode.value = '';
    connectionCode.value = '';
    sourceCode.value = '';
    rows.value = [];
    visible.value = false;
    void load();
  },
  { immediate: true },
);
watch(page, () => void load());
</script>
<template>
  <n-card title="运行与异常"
    ><n-tabs v-model:value="tab"
      ><n-tab-pane name="runs" tab="采集执行" /><n-tab-pane name="incidents" tab="站内异常" /><n-tab-pane
        v-if="canManage"
        name="audit"
        tab="查询审计" /></n-tabs
    ><n-space v-if="tab === 'runs'" class="gap"
      ><n-input v-model:value="systemCode" placeholder="系统编码（精确匹配）" style="width: 200px" /><n-input
        v-model:value="instanceCode"
        placeholder="实例编码"
        style="width: 160px" /><n-input
        v-model:value="connectionCode"
        placeholder="连接编码"
        style="width: 160px" /><n-input
        v-model:value="sourceCode"
        placeholder="通道来源编码"
        style="width: 200px" /><n-select
        v-model:value="state"
        :options="[
          { label: '全部执行状态', value: '' },
          ...['QUEUED', 'RUNNING', 'COMPLETE', 'FAILED', 'INCOMPLETE', 'CANCELLED'].map((value) => ({
            label: value,
            value,
          })),
        ]"
        style="width: 190px" /></n-space
    ><n-space class="gap"
      ><n-input
        v-if="tab !== 'audit'"
        v-model:value="q"
        placeholder="按来源或数据集搜索"
        @keyup.enter="
          page = 1;
          load();
        "
      /><n-select
        v-if="tab === 'incidents'"
        v-model:value="state"
        :options="[
          { label: '全部状态', value: '' },
          { label: '待处理', value: 'OPEN' },
          { label: '已确认', value: 'ACKNOWLEDGED' },
          { label: '已恢复', value: 'RECOVERED' },
        ]"
        style="width: 150px"
      /><n-button
        @click="
          page = 1;
          load();
        "
        >刷新 / 搜索</n-button
      ><n-button v-if="tab === 'incidents' && canOperate" @click="reconcile">对账异常与真实恢复</n-button></n-space
    ><n-alert v-if="error" type="error" class="gap">{{ error }}</n-alert
    ><n-data-table
      :columns="tab === 'runs' ? runColumns : tab === 'incidents' ? incidentColumns : auditColumns"
      :data="rows"
      :loading="busy" /><n-pagination v-model:page="page" :item-count="total" :page-size="25" class="gap"
  /></n-card>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="tab === 'runs' ? '采集执行详情' : '异常观察与处理'"
    style="width: min(980px, 96vw)"
    ><n-alert v-if="error" type="error" class="gap">{{ error }}</n-alert>
    <pre class="json-detail">{{ JSON.stringify(detail, null, 2) }}</pre>
    <template v-if="tab === 'runs' && canOperate"
      ><n-space class="gap"
        ><n-button
          v-if="['FAILED', 'INCOMPLETE', 'CANCELLED'].includes(detail?.state)"
          :loading="busy"
          @click="operate('retry')"
          >重试此窗口</n-button
        ><n-button v-if="['QUEUED', 'RUNNING'].includes(detail?.state)" @click="operate('cancel')"
          >取消此次执行</n-button
        ></n-space
      ><template v-if="canManage && detail?.error_code === 'SCHEMA_CHANGE_REVIEW_REQUIRED'"
        ><n-form-item label="确认结构差异的原因"><n-input v-model:value="reason" /></n-form-item
        ><n-button :disabled="!reason.trim()" @click="operate('approve-schema')"
          >批准已显示的结构差异</n-button
        ></template
      ></template
    ><template v-if="tab === 'incidents' && canOperate && detail?.incident.state !== 'RECOVERED'"
      ><n-alert type="info" class="gap">确认表示有人处理；只有对应完整执行或发布成功才能恢复。</n-alert
      ><n-space
        ><n-form-item label="项目内处理人账号"><n-input v-model:value="owner" /></n-form-item
        ><n-form-item label="处置说明"><n-input v-model:value="reason" /></n-form-item></n-space
      ><n-button type="primary" :loading="busy" :disabled="!reason.trim()" @click="acknowledge"
        >确认并分配负责人</n-button
      ></template
    ></n-modal
  >
</template>
