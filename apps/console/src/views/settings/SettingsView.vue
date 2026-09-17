<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NTabPane,
  NTabs,
} from 'naive-ui';
import { api } from '@/api';
import { usePermissionStore } from '@/stores/permission';
import { useProjectStore } from '@/stores/project';
import { useSessionStore } from '@/stores/session';
import { useErrorToast } from '@/composables/useErrorToast';
const session = useSessionStore();
const permission = usePermissionStore();
const project = useProjectStore();
const projectId = computed(() => project.selected?.id ?? 0);
const canManage = computed(() => permission.canManage);
const admin = computed(() => session.isAdmin);
const identity = computed(() => session.identity?.identity ?? '');
const error = ref(''),
  busy = ref(false),
  members = ref<Record<string, any>[]>([]),
  services = ref<Record<string, any>[]>([]),
  environments = ref<Record<string, any>[]>([]),
  resources = ref<Record<string, any>[]>([]),
  workers = ref<Record<string, any>[]>([]),
  secret = ref(''),
  secretTitle = ref(''),
  secretVisible = ref(false);
const member = reactive({ identity: '', displayName: '', role: 'VIEWER' }),
  service = reactive({ id: '', role: 'VIEWER' }),
  projectForm = reactive({ code: '', name: '', description: '' });
const environment = reactive({ code: '', name: '', workerIds: '', maxParallel: 2 });
const resource = reactive({
  code: '',
  name: '',
  environment: '',
  kind: 'FILE_SCAN',
  resourceGroup: '',
  maxParallel: 1,
  maxBytes: 1073741824,
  requestsPerSecond: 5,
});
const repository = reactive({ code: '', name: '', workerIds: '', projectPaths: '' });
const datasource = reactive({
  datasourceType: 'MYSQL',
  host: '',
  port: 3306,
  database: '',
  charset: 'utf8mb4',
  timezone: 'Asia/Shanghai',
  credentialRef: '',
  statementTimeoutMs: 3600000,
  allowedTables: '',
  allowedSchemas: '',
});
const testState = ref('');
const roleOptions = [
  { label: '查看者', value: 'VIEWER' },
  { label: '数据工程师', value: 'ENGINEER' },
  { label: '项目负责人', value: 'OWNER' },
];
const memberColumns = [
  { title: '账号', key: 'identity_id' },
  { title: '角色', key: 'role' },
  { title: '启用', key: 'enabled', render: (r: any) => (r.enabled ? '是' : '否') },
  {
    title: '操作',
    key: 'actions',
    render: (r: any) =>
      h(NSpace, {}, () => [
        h(
          NButton,
          {
            size: 'small',
            onClick: () => Object.assign(member, { identity: r.identity_id, role: r.role, displayName: r.identity_id }),
          },
          () => '调整角色',
        ),
        ...(admin.value
          ? [
              h(NButton, { size: 'small', onClick: () => reset(r.identity_id) }, () => '重置密码'),
              h(NButton, { size: 'small', onClick: () => revokeSession(r.identity_id) }, () => '撤销会话'),
            ]
          : []),
      ]),
  },
];
const serviceColumns = [
  { title: '服务身份', key: 'identity_id' },
  { title: '角色', key: 'role' },
  { title: '令牌版本', key: 'token_revision' },
  {
    title: '操作',
    key: 'actions',
    render: (r: any) =>
      h(NSpace, {}, () => [
        h(NButton, { size: 'small', disabled: !r.enabled, onClick: () => rotate(r) }, () => '轮换令牌'),
        h(NButton, { size: 'small', disabled: !r.enabled, onClick: () => revoke(r) }, () => '停用'),
      ]),
  },
];
async function action(work: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await work();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function load() {
  if (projectId.value && canManage.value)
    [members.value, services.value] = await Promise.all([
      api<Record<string, any>[]>(`/warehouse/projects/${projectId.value}/members`),
      api<Record<string, any>[]>(`/warehouse/projects/${projectId.value}/service-identities`),
    ]);
  if (admin.value) {
    environments.value = await api('/warehouse/environments');
    workers.value = await api('/warehouse/workers');
    if (projectId.value) resources.value = await api(`/warehouse/projects/${projectId.value}/resources`);
  }
}
async function copySecret() {
  try {
    await navigator.clipboard.writeText(secret.value);
  } catch {
    error.value = '无法复制，请展开后手动保存';
  }
}
function reveal(title: string, value: string) {
  secretTitle.value = title;
  secret.value = value;
  secretVisible.value = true;
}
async function invite() {
  await action(async () => {
    const result = await api<{ invitation: string }>('/warehouse/accounts/invite', {
      ...member,
      projectId: projectId.value,
    });
    reveal('一次性开户邀请（24 小时有效）', result.invitation);
    await load();
  });
}
async function saveMember() {
  await action(async () => {
    await api(`/warehouse/projects/${projectId.value}/members`, { identity: member.identity, role: member.role });
    await load();
  });
}
async function reset(id: string) {
  await action(async () => {
    const result = await api<{ invitation: string }>(`/warehouse/accounts/${id}/reset`, {});
    reveal('一次性密码重置邀请', result.invitation);
  });
}
async function revokeSession(id: string) {
  await action(async () => {
    await api(`/warehouse/accounts/${id}/revoke-sessions`, {});
    if (id === identity.value) window.dispatchEvent(new Event('session-expired'));
  });
}
async function createService() {
  await action(async () => {
    const result = await api<{ token: string }>(`/warehouse/projects/${projectId.value}/service-identities`, service);
    reveal('服务令牌，仅此处显示', result.token);
    await load();
  });
}
async function rotate(row: Record<string, any>) {
  await action(async () => {
    const result = await api<{ token: string }>(
      `/warehouse/projects/${projectId.value}/service-identities/${row.identity_id}/rotate`,
      { expectedRevision: row.token_revision },
    );
    reveal('新服务令牌，旧令牌已失效', result.token);
    await load();
  });
}
async function revoke(row: Record<string, any>) {
  await action(async () => {
    await api(`/warehouse/projects/${projectId.value}/service-identities/${row.identity_id}/revoke`, {
      expectedRevision: row.token_revision,
    });
    await load();
  });
}
async function createProject() {
  await action(async () => {
    await api('/warehouse/projects', projectForm);
    Object.assign(projectForm, { code: '', name: '', description: '' });
    await session.identify();
  });
}
async function saveEnvironment() {
  await action(async () => {
    await api('/warehouse/environments', {
      ...environment,
      workerIds: environment.workerIds
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    });
    await load();
  });
}
async function saveResource() {
  await action(async () => {
    const result = await api<{ id: number }>('/warehouse/resources', resource);
    await api(`/warehouse/resources/${result.id}/grant`, { projectId: projectId.value });
    if (resource.kind === 'MYSQL_SNAPSHOT') {
      await api(`/warehouse/resources/${result.id}/datasource`, {
        datasourceType: datasource.datasourceType,
        config: {
          host: datasource.host,
          port: datasource.port,
          database: datasource.database,
          charset: datasource.charset,
          timezone: datasource.timezone,
        },
        credentialRef: datasource.credentialRef,
        statementTimeoutMs: datasource.statementTimeoutMs,
        allowedTables: datasource.allowedTables
          .split('\n')
          .map((v: string) => v.trim())
          .filter(Boolean),
        allowedSchemas: datasource.allowedSchemas
          .split(',')
          .map((v: string) => v.trim())
          .filter(Boolean),
      });
      testState.value = '数据源已登记，正在测试连接…';
      const request = await api<{ id: number }>(`/warehouse/resources/${result.id}/tests`, {
        requestKey: crypto.randomUUID(),
      });
      void pollTest(result.id, request.id);
    }
    await load();
  });
}
async function pollTest(resourceId: number, requestId: number) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rows = await api<Record<string, any>[]>(`/warehouse/resources/${resourceId}/tests`);
    const row = rows.find((item) => item.id === requestId);
    if (row && ['PASSED', 'FAILED'].includes(row.state)) {
      testState.value =
        row.state === 'PASSED'
          ? `连接测试通过：服务器 ${row.server_version || '未知'} · 时区 ${row.server_timezone || '未知'} · 可读库 ${row.readable_schema_count ?? '未知'} · 只读已验证`
          : `连接测试失败：${row.error_code || '未知原因'}${row.read_only_verified === false ? '（该账号可写，不符合只读要求）' : ''}`;
      await load();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  testState.value = '连接测试超时：请确认工作器在线并且网络可达';
}
async function testDatasource(row: Record<string, any>) {
  await action(async () => {
    testState.value = `正在测试 ${row.code} …`;
    const request = await api<{ id: number }>(`/warehouse/resources/${row.id}/tests`, {
      requestKey: crypto.randomUUID(),
    });
    await pollTest(row.id, request.id);
  });
}
async function saveRepository() {
  await action(async () => {
    await api('/warehouse/model-repositories', {
      ...repository,
      workerIds: repository.workerIds
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      projectPaths: repository.projectPaths
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean),
    });
    await api(`/warehouse/model-repositories/${repository.code}/grant`, { projectId: projectId.value });
  });
}
watch(
  () => [projectId.value, canManage.value],
  () => {
    members.value = [];
    services.value = [];
    void action(load);
  },
  { immediate: true },
);
watch(secretVisible, (value) => {
  if (!value) secret.value = '';
});
useErrorToast(error);
</script>
<template>
  <n-card v-if="admin" title="创建项目" class="gap"
    ><n-space
      ><n-form-item label="项目编码"><n-input v-model:value="projectForm.code" /></n-form-item
      ><n-form-item label="项目名称"><n-input v-model:value="projectForm.name" /></n-form-item
      ><n-button :loading="busy" @click="createProject">创建项目</n-button></n-space
    ></n-card
  >
  <n-card v-if="project && canManage" title="项目管理"
    ><n-tabs>
      <n-tab-pane name="members" tab="成员与会话"
        ><n-data-table :columns="memberColumns" :data="members" /><n-space class="gap"
          ><n-form-item label="账号"><n-input v-model:value="member.identity" /></n-form-item
          ><n-form-item label="显示名称"><n-input v-model:value="member.displayName" /></n-form-item
          ><n-form-item label="项目角色"
            ><n-select v-model:value="member.role" :options="roleOptions" style="width: 160px" /></n-form-item></n-space
        ><n-space
          ><n-button type="primary" :loading="busy" @click="invite">邀请新账号</n-button
          ><n-button @click="saveMember">为已有账号设置角色</n-button></n-space
        ></n-tab-pane
      >
      <n-tab-pane name="services" tab="服务身份"
        ><p>报表调用使用查看者身份并授权数据集；自动刷新使用独立工程师身份，批准自动发布时使用负责人身份。</p>
        <n-data-table :columns="serviceColumns" :data="services" /><n-space class="gap"
          ><n-form-item label="服务身份编码"
            ><n-input v-model:value="service.id" placeholder="如 report_client" /></n-form-item
          ><n-form-item label="项目角色"
            ><n-select v-model:value="service.role" :options="roleOptions" style="width: 170px" /></n-form-item
          ><n-button type="primary" :loading="busy" @click="createService">创建服务身份</n-button></n-space
        ></n-tab-pane
      >
      <n-tab-pane v-if="admin" name="resources" tab="执行资源"
        ><p>引用、Worker 标识和资源组必须与本机批准注册表一致。凭证及宿主路径在本机管理。</p>
        <n-data-table
          :columns="[
            { title: '资源', key: 'name' },
            { title: '引用', key: 'code' },
            { title: '环境', key: 'environment_code' },
            { title: '类型', key: 'datasource_type', render: (r: any) => r.datasource_type || '—' },
            {
              title: '连接测试',
              key: 'last_test_state',
              render: (r: any) =>
                r.datasource_type
                  ? r.last_test_state === 'PASSED'
                    ? '通过'
                    : r.last_test_state === 'FAILED'
                      ? '失败'
                      : '未测试'
                  : '不适用',
            },
            {
              title: '操作',
              key: 'actions',
              render: (r: any) =>
                r.datasource_type
                  ? h(NButton, { size: 'small', onClick: () => testDatasource(r) }, () => '测试连接')
                  : null,
            },
            { title: '共享组', key: 'resource_group' },
            { title: '并发', key: 'max_parallel' },
          ]"
          :data="resources"
        />
        <h3>Worker 与存储</h3>
        <n-data-table
          :columns="[
            { title: '执行环境', key: 'environment_code' },
            { title: 'Worker', key: 'worker_id' },
            { title: '在线', key: 'online', render: (r: any) => (r.online ? '在线' : '超过 90 秒未收到心跳') },
            { title: '可用空间（字节）', key: 'metrics', render: (r: any) => r.metrics.availableBytes },
            { title: '最后心跳', key: 'last_seen_at' },
          ]"
          :data="workers"
        /><n-button class="gap" @click="action(load)">刷新资源状态</n-button>
        <h3>登记执行环境</h3>
        <n-space
          ><n-form-item label="环境编码"><n-input v-model:value="environment.code" /></n-form-item
          ><n-form-item label="环境名称"><n-input v-model:value="environment.name" /></n-form-item
          ><n-form-item label="Worker ID（逗号分隔）"><n-input v-model:value="environment.workerIds" /></n-form-item
          ><n-form-item label="环境并发"
            ><n-input-number v-model:value="environment.maxParallel" :min="1" :max="100" /></n-form-item></n-space
        ><n-button @click="saveEnvironment">登记环境</n-button>
        <h3>登记资源并授权当前项目</h3>
        <n-space
          ><n-form-item label="资源引用"><n-input v-model:value="resource.code" /></n-form-item
          ><n-form-item label="名称"><n-input v-model:value="resource.name" /></n-form-item
          ><n-form-item label="执行环境"
            ><n-select
              v-model:value="resource.environment"
              :options="environments.map((e) => ({ label: e.name, value: e.code }))"
              style="width: 190px" /></n-form-item
          ><n-form-item label="类型"
            ><n-select
              v-model:value="resource.kind"
              :options="[
                { label: '文件目录', value: 'FILE_SCAN' },
                { label: 'MySQL', value: 'MYSQL_SNAPSHOT' },
                { label: 'REST API', value: 'REST_PULL' },
              ]"
              style="width: 160px" /></n-form-item
          ><n-form-item label="共享资源组"><n-input v-model:value="resource.resourceGroup" /></n-form-item
          ><n-form-item label="并发"
            ><n-input-number v-model:value="resource.maxParallel" :min="1" :max="100" /></n-form-item
          ><n-form-item label="读取预算（字节）"
            ><n-input-number v-model:value="resource.maxBytes" :min="1024" :max="1099511627776" /></n-form-item
          ><n-form-item label="API 每秒请求"
            ><n-input-number v-model:value="resource.requestsPerSecond" :min="0.1" :max="100" /></n-form-item></n-space
        ><n-alert v-if="resource.kind === 'MYSQL_SNAPSHOT'" type="info" class="gap"
          >MySQL
          数据源需要非敏感连接信息与只读凭据引用；密码只存在于本机私有文件（datasources/&lt;引用&gt;.json），页面与数据库都不保存。</n-alert
        ><n-space v-if="resource.kind === 'MYSQL_SNAPSHOT'"
          ><n-form-item label="数据源类型"
            ><n-select
              v-model:value="datasource.datasourceType"
              :options="[{ label: 'MySQL', value: 'MYSQL' }]"
              style="width: 140px" /></n-form-item
          ><n-form-item label="主机"
            ><n-input v-model:value="datasource.host" placeholder="例如 source-mysql" /></n-form-item
          ><n-form-item label="端口"
            ><n-input-number v-model:value="datasource.port" :min="1" :max="65535" /></n-form-item
          ><n-form-item label="数据库"><n-input v-model:value="datasource.database" /></n-form-item
          ><n-form-item label="字符集"
            ><n-select
              v-model:value="datasource.charset"
              :options="['utf8mb4', 'utf8', 'gb18030', 'latin1'].map((v) => ({ label: v, value: v }))"
              style="width: 140px" /></n-form-item
          ><n-form-item label="源库时区"><n-input v-model:value="datasource.timezone" /></n-form-item
          ><n-form-item label="凭据引用"
            ><n-input v-model:value="datasource.credentialRef" placeholder="例如 erp-readonly" /></n-form-item
          ><n-form-item label="语句超时(ms)"
            ><n-input-number
              v-model:value="datasource.statementTimeoutMs"
              :min="1000"
              :max="86400000" /></n-form-item></n-space
        ><n-form-item v-if="resource.kind === 'MYSQL_SNAPSHOT'" label="允许的表（每行一项，用于 SQL 校验与编辑提示）"
          ><n-input
            v-model:value="datasource.allowedTables"
            type="textarea"
            placeholder="biz_order&#10;customer" /></n-form-item
        ><n-button @click="saveResource">登记并授权</n-button
        ><n-alert v-if="testState" type="success" class="gap">{{ testState }}</n-alert></n-tab-pane
      >
      <n-tab-pane v-if="admin" name="repositories" tab="批准模型仓库"
        ><p>仓库引用指向 Worker 本机批准的 Git 持久目录。当前页面只登记引用、模型子路径和授权范围。</p>
        <n-space
          ><n-form-item label="仓库引用"><n-input v-model:value="repository.code" /></n-form-item
          ><n-form-item label="名称"><n-input v-model:value="repository.name" /></n-form-item
          ><n-form-item label="模型 Worker ID（逗号分隔）"
            ><n-input v-model:value="repository.workerIds" /></n-form-item></n-space
        ><n-form-item label="允许模型子路径（每行一项）"
          ><n-input
            v-model:value="repository.projectPaths"
            type="textarea"
            placeholder="models/commerce" /></n-form-item
        ><n-button type="primary" :loading="busy" @click="saveRepository">登记并授权当前项目</n-button></n-tab-pane
      >
    </n-tabs></n-card
  >
  <n-card title="当前会话" class="gap"
    ><n-button @click="revokeSession(identity)">撤销我所有浏览器会话</n-button></n-card
  >
  <n-modal v-model:show="secretVisible" preset="card" :title="secretTitle" style="width: min(650px, 94vw)"
    ><p>请将此值保存到适当的安全位置或交给指定使用者，关闭后页面不会保留。</p>
    <n-input :value="secret" type="password" show-password-on="click" readonly /><n-button
      class="gap"
      @click="copySecret"
      >复制</n-button
    ></n-modal
  >
</template>
