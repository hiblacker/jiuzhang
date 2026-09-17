<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import { NAlert, NButton, NEmpty, NModal, NSelect, NTabs, NTabPane, NTag, useMessage, useDialog } from 'naive-ui';
import { Plus, Download, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { engineer, owner, projectId, useApi } from '../api';
import { useTabs } from '../tabs';
import { type Action, type Dataset, type Field, type QueryResult, type Row } from '../types';
import ActionForm from '../components/ActionForm.vue';
import DataGrid from '../components/DataGrid.vue';
import DetailDrawer from '../components/DetailDrawer.vue';
const { loading, error, run, call } = useApi(),
  message = useMessage(),
  dialog = useDialog();
onScopeDispose(() => dialog.destroyAll());
const project = projectId.value;
const datasets = ref<Dataset[]>([]),
  datasetId = ref<number | null>(null);
const builds = ref<Row[]>([]),
  versions = ref<Row[]>([]),
  releases = ref<Row[]>([]);
const detail = ref<unknown>(),
  detailTitle = ref('详情'),
  showDetail = ref(false);
const modal = ref(false),
  modalTitle = ref(''),
  formFields = ref<Field[]>([]),
  initial = ref<Row>({});
const result = ref<QueryResult | null>(null),
  lastQuery = ref<Row | null>(null);
const { activeTab, tabProps, panelProps } = useTabs('query');
// eslint-disable-next-line @typescript-eslint/require-await -- the declared handler type returns a Promise
let submitAction: (value: Row) => Promise<unknown> = async () => undefined;
const selected = computed(() => datasets.value.find((d) => d.id === datasetId.value));
function route() {
  if (!project || !datasetId.value) throw new Error('请先选择项目和数据集');
  return `warehouse/projects/${project}/datasets/${datasetId.value}`;
}
async function loadDataset() {
  builds.value = [];
  versions.value = [];
  releases.value = [];
  result.value = null;
  lastQuery.value = null;
  showDetail.value = false;
  detail.value = null;
  if (!datasetId.value) return;
  const path = route();
  const values = await Promise.all([
    call<Row[]>(`${path}/versions`),
    call<Row[]>(`${path}/releases`),
    engineer.value ? call<Row[]>(`${path}/builds`) : Promise.resolve([]),
  ]);
  [versions.value, releases.value, builds.value] = values;
}
async function load() {
  if (!project) return;
  datasets.value = await call<Dataset[]>(`warehouse/projects/${project}/datasets`);
  if (!datasets.value.some((d) => d.id === datasetId.value)) datasetId.value = datasets.value[0]?.id ?? null;
  await loadDataset();
}
function inspect(title: string, value: unknown) {
  detailTitle.value = title;
  detail.value = value;
  showDetail.value = true;
}
function open(title: string, fields: Field[], value: Row, action: (v: Row) => Promise<unknown>) {
  modalTitle.value = title;
  formFields.value = fields;
  initial.value = value;
  submitAction = action;
  modal.value = true;
}
async function save(value: Row) {
  await run(async () => {
    await submitAction(value);
    modal.value = false;
    message.success('操作已提交');
    await load();
  });
}
function modelForm(version?: Row) {
  const fields: Field[] = [
    { key: 'code', label: '数据集编码', required: true, disabled: !!version },
    { key: 'name', label: '数据集名称', required: true },
    { key: 'runtimeRef', label: '执行配置名', required: true },
    { key: 'expectedVersion', label: '当前模型版本', type: 'number', min: 0, required: true, disabled: true },
    { key: 'gitRevision', label: 'Git 提交（40 位）', required: true },
    { key: 'bundleSha256', label: '模型包 SHA-256', required: true },
    { key: 'contract', label: '数据契约', type: 'json', required: true },
  ];
  open(
    version ? '登记模型新版本' : '登记模型',
    fields,
    version
      ? {
          code: selected.value?.code,
          name: selected.value?.name,
          runtimeRef: version.runtime_ref,
          expectedVersion: selected.value?.active_model_version,
          gitRevision: version.git_revision,
          bundleSha256: version.bundle_sha256,
          contract: version.contract,
        }
      : { expectedVersion: 0, contract: {} },
    async (value) => {
      if (!/^[0-9a-f]{40}$/.test(String(value.gitRevision))) throw new Error('Git 提交必须为 40 位十六进制值');
      if (!/^[0-9a-f]{64}$/.test(String(value.bundleSha256))) throw new Error('模型包摘要必须为 64 位十六进制值');
      const response = await call<{ id: number }>(`warehouse/projects/${project}/models`, value);
      datasetId.value = response.id;
      return response;
    },
  );
}
function buildForm() {
  const path = route(),
    requestKey = crypto.randomUUID();
  open(
    '构建候选',
    [
      {
        key: 'modelVersion',
        label: '模型版本',
        type: 'select',
        required: true,
        options: versions.value.map((v) => ({ label: `v${v.version}`, value: Number(v.version) })),
      },
      { key: 'inputs', label: '输入资产（别名与资产 ID）', type: 'json', required: true },
    ],
    { modelVersion: selected.value?.active_model_version, inputs: {} },
    (value) => call(`${path}/builds`, { ...value, requestKey }),
  );
}
function actions(row: Row): Action[] {
  const items: Action[] = [{ label: '质量与依赖', run: () => inspect('质量与依赖', row) }];
  const path = route();
  if (owner.value && row.state === 'READY')
    items.push({
      label: '发布',
      run: () =>
        open(`发布候选 #${row.id}`, [{ key: 'reason', label: '发布理由', type: 'textarea', required: true }], {}, (v) =>
          call(`${path}/builds/${row.id}/publish`, v),
        ),
    });
  if (engineer.value && ['QUEUED', 'RUNNING'].includes(String(row.state)))
    items.push({
      label: '取消',
      danger: true,
      run: () =>
        dialog.warning({
          title: '取消模型构建',
          content: `构建 #${row.id}`,
          positiveText: '确认取消',
          negativeText: '返回',
          onPositiveClick: () =>
            run(async () => {
              await call(`${path}/builds/${row.id}/cancel`, {});
              await load();
            }),
        }),
    });
  return items;
}
const queryFields: Field[] = [
  { key: 'releaseId', label: '发布 ID（留空使用当前版本）', type: 'number', min: 1 },
  { key: 'columns', label: '列（逗号分隔，留空使用授权范围）' },
  { key: 'limit', label: '每页行数', type: 'number', min: 1, max: 1000, required: true },
  { key: 'equals', label: '等值筛选', type: 'json' },
];
async function query(value: Row) {
  await run(async () => {
    result.value = null;
    lastQuery.value = null;
    const body: Row = { limit: value.limit, offset: 0, equals: value.equals };
    if (value.releaseId) body.releaseId = value.releaseId;
    if (String(value.columns ?? '').trim())
      body.columns = String(value.columns)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (!value.equals || typeof value.equals !== 'object' || Array.isArray(value.equals))
      throw new Error('等值筛选必须为 JSON 对象');
    const response = await call<QueryResult>(`${route()}/query`, body);
    result.value = response;
    lastQuery.value = { ...body, releaseId: response.releaseId, columns: response.columns };
  });
}
async function page(offset: number) {
  await run(async () => {
    if (!lastQuery.value) return;
    const body = { ...lastQuery.value, offset };
    result.value = await call<QueryResult>(`${route()}/query`, body);
    lastQuery.value = body;
  });
}
async function exportPage() {
  await run(async () => {
    if (!lastQuery.value || !result.value) return;
    const blob = await call<Blob>(`${route()}/export`, lastQuery.value, true);
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = `dataset-${result.value.datasetId}-release-${result.value.releaseId}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
function policyForm() {
  const path = route();
  open(
    '数据授权',
    [
      { key: 'identity', label: '身份编码', required: true },
      { key: 'columns', label: '允许列（逗号分隔）', required: true },
      { key: 'rowEquals', label: '行范围（等值条件）', type: 'json' },
    ],
    { rowEquals: {} },
    (v) =>
      call(`${path}/policy`, {
        ...v,
        columns: String(v.columns)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
  );
}
onMounted(() => run(load));
</script>
<template>
  <n-alert v-if="error" type="error" class="section-gap">{{ error }}</n-alert>
  <n-empty v-if="!project" description="暂无可访问的项目" />
  <template v-else>
    <div class="dataset-bar">
      <n-select
        v-model:value="datasetId"
        :options="datasets.map((d) => ({ label: d.name, value: d.id }))"
        placeholder="选择数据集"
        :input-props="{ 'aria-label': '当前数据集' }"
        :disabled="loading"
        filterable
        @update:value="run(loadDataset)"
      /><n-tag v-if="selected" :bordered="false">模型 v{{ selected.active_model_version }}</n-tag
      ><n-tag v-if="selected?.active_release_id" type="success" :bordered="false"
        >Release {{ selected.active_release_id }}</n-tag
      ><n-button v-if="engineer" type="primary" :disabled="loading" @click="modelForm()"
        ><template #icon><Plus :size="16" /></template>登记模型</n-button
      >
    </div>
    <n-empty v-if="!datasetId && !loading" description="暂无数据集" />
    <section v-if="datasetId" class="section">
      <n-tabs v-model:value="activeTab" type="line">
        <n-tab-pane name="query" tab="数据查询" :tab-props="tabProps('query')" v-bind="panelProps('query')"
          ><ActionForm
            :key="`query-${datasetId}`"
            :fields="queryFields"
            :initial="{ limit: 100, equals: {} }"
            :busy="loading"
            submit-label="查询数据"
            @submit="query"
          />
          <div v-if="result" class="section-gap">
            <div class="toolbar">
              <div class="query-meta">
                <span>Release {{ result.releaseId }}</span
                ><span>授权版本 {{ result.policyRevision }}</span
                ><span>{{ result.rows.length }} 行</span>
              </div>
              <n-button class="push" :disabled="loading" @click="exportPage"
                ><template #icon><Download :size="16" /></template>导出当前页</n-button
              >
            </div>
            <DataGrid
              :rows="result.rows"
              :columns="result.columns.map((key) => ({ key, title: key, width: 180 }))"
              :paginated="false"
              :loading="loading"
            />
            <div class="pager">
              <n-button
                :disabled="loading || result.offset === 0"
                @click="page(Math.max(0, result.offset - result.limit))"
                ><template #icon><ChevronLeft :size="16" /></template>上一页</n-button
              ><n-button
                :disabled="loading || result.rows.length < result.limit || result.offset + result.limit > 100000"
                @click="page(result.offset + result.limit)"
                >下一页<template #icon><ChevronRight :size="16" /></template
              ></n-button>
            </div>
          </div>
        </n-tab-pane>
        <n-tab-pane name="versions" tab="模型版本" :tab-props="tabProps('versions')" v-bind="panelProps('versions')"
          ><DataGrid
            :rows="versions"
            :columns="[
              { key: 'version', title: '版本', width: 80 },
              { key: 'git_revision', title: 'Git 提交', width: 350 },
              { key: 'created_by', title: '创建身份' },
              { key: 'created_at', title: '登记时间', width: 220 },
            ]"
            :loading="loading"
            :actions="
              (row) => [
                { label: '契约详情', run: () => inspect('模型契约', row) },
                ...(engineer
                  ? [
                      { label: '登记新版本', run: () => modelForm(row) },
                      {
                        label: '变更影响',
                        run: () =>
                          run(async () => inspect('变更影响', await call(`${route()}/impact?version=${row.version}`))),
                      },
                    ]
                  : []),
              ]
            "
        /></n-tab-pane>
        <n-tab-pane
          v-if="engineer"
          name="builds"
          tab="构建与质量"
          :tab-props="tabProps('builds')"
          v-bind="panelProps('builds')"
          ><div class="toolbar">
            <n-button type="primary" :disabled="loading || !versions.length" @click="buildForm">构建候选</n-button>
          </div>
          <DataGrid
            :rows="builds"
            :loading="loading"
            :columns="[
              { key: 'id', title: '构建', width: 80 },
              { key: 'model_version', title: '模型版本', width: 90 },
              { key: 'state', title: '状态', state: true },
              { key: 'error_code', title: '错误', width: 220 },
              { key: 'finished_at', title: '完成时间', width: 220 },
            ]"
            :actions="actions"
        /></n-tab-pane>
        <n-tab-pane name="releases" tab="发布历史" :tab-props="tabProps('releases')" v-bind="panelProps('releases')"
          ><DataGrid
            :rows="releases"
            :loading="loading"
            :columns="[
              { key: 'id', title: 'Release', width: 80 },
              { key: 'model_version', title: '模型版本', width: 90 },
              { key: 'published_by', title: '发布身份' },
              { key: 'published_at', title: '发布时间', width: 220 },
              { key: 'reason', title: '理由', width: 220 },
            ]"
            :actions="(row) => [{ label: '详情', run: () => inspect('发布详情', row) }]"
        /></n-tab-pane>
        <n-tab-pane
          v-if="owner"
          name="policy"
          tab="行列授权"
          :tab-props="tabProps('policy')"
          v-bind="panelProps('policy')"
          ><n-button :disabled="loading" @click="policyForm">配置数据授权</n-button></n-tab-pane
        >
      </n-tabs>
    </section>
  </template>
  <n-modal
    v-model:show="modal"
    preset="card"
    class="action-modal"
    :title="modalTitle"
    :mask-closable="!loading"
    :closable="!loading"
    ><n-alert v-if="error" type="error" class="section-gap">{{ error }}</n-alert
    ><ActionForm
      :key="modalTitle + JSON.stringify(initial)"
      :fields="formFields"
      :initial="initial"
      :busy="loading"
      submit-label="确认提交"
      @submit="save"
  /></n-modal>
  <DetailDrawer v-model:show="showDetail" :title="detailTitle" :value="detail" />
</template>
