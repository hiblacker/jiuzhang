<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue'
import { NAlert, NButton, NEmpty, NModal, NTabs, NTabPane, NInput, useDialog, useMessage } from 'naive-ui'
import { Plus } from 'lucide-vue-next'
import { loadProjects, owner, projectId, projects, session, useApi } from '../api'
import { useTabs } from '../tabs'
import type { Field, Row } from '../types'
import DataGrid from '../components/DataGrid.vue'
import ActionForm from '../components/ActionForm.vue'
const { loading, error, run, call } = useApi(), dialog = useDialog(), message = useMessage()
onScopeDispose(() => dialog.destroyAll())
const project = projectId.value, admin = session.mode === 'admin'
const { activeTab, tabProps, panelProps } = useTabs(admin ? 'projects' : 'sources')
const members = ref<Row[]>([]), identities = ref<Row[]>([]), sources = ref<Row[]>([])
const modal = ref(false), modalTitle = ref(''), fields = ref<Field[]>([]), initial = ref<Row>({})
const issuedToken = ref(''), issuedIdentity = ref('')
let submitAction: (v: Row) => Promise<unknown> = async () => undefined
async function load() {
  if (admin) identities.value = await call<Row[]>('warehouse/identities')
  if (project) {
    sources.value = await call<Row[]>(`warehouse/projects/${project}/sources`)
    if (owner.value) members.value = await call<Row[]>(`warehouse/projects/${project}/members`)
  }
}
function open(title: string, items: Field[], value: Row, action: (v: Row) => Promise<unknown>) { modalTitle.value = title; fields.value = items; initial.value = value; submitAction = action; modal.value = true }
async function save(value: Row) { await run(async () => { await submitAction(value); modal.value = false; message.success('操作已提交'); await load(); await loadProjects() }) }
function projectForm() { open('创建项目', [{ key: 'code', label: '项目编码', required: true }, { key: 'name', label: '项目名称', required: true }, { key: 'description', label: '项目说明', type: 'textarea' }], {}, v => call('warehouse/projects', v)) }
function identityForm() { open('创建身份', [{ key: 'id', label: '身份编码', required: true }], {}, async v => { const r = await call<{ id: string; token: string }>('warehouse/identities', v); issuedIdentity.value = r.id; issuedToken.value = r.token; return r }) }
function memberForm(row?: Row) { open('保存成员角色', [{ key: 'identity', label: '身份编码', required: true, disabled: !!row }, { key: 'role', label: '角色', type: 'select', required: true, options: [{ label: '查看者', value: 'VIEWER' }, { label: '数据开发', value: 'ENGINEER' }, { label: '项目管理员', value: 'OWNER' }] }], { identity: row?.identity_id ?? '', role: row?.role ?? 'VIEWER' }, v => call(`warehouse/projects/${project}/members`, v)) }
function bindSource() { open('分配来源', [{ key: 'sourceCode', label: '来源编码', required: true }], {}, v => call(`warehouse/projects/${project}/sources`, v)) }
function revoke(row: Row) { dialog.warning({ title: '撤销身份', content: `身份 ${row.id} 将立即失去访问权限。`, positiveText: '确认撤销', negativeText: '返回', onPositiveClick: () => run(async () => { await call(`warehouse/identities/${encodeURIComponent(String(row.id))}/revoke`, {}); await load() }) }) }
onMounted(() => run(load))
</script>
<template>
  <n-alert v-if="error" type="error" class="section-gap">{{ error }}</n-alert>
  <section class="section"><n-tabs v-model:value="activeTab" type="line">
    <n-tab-pane v-if="admin" name="projects" tab="项目" :tab-props="tabProps('projects')" v-bind="panelProps('projects')"><div class="toolbar"><n-button type="primary" :disabled="loading" @click="projectForm"><template #icon><Plus :size="16" /></template>创建项目</n-button></div><DataGrid :rows="projects" :loading="loading" :columns="[{ key: 'code', title: '编码' }, { key: 'name', title: '名称' }, { key: 'description', title: '说明', width: 300 }]" /></n-tab-pane>
    <n-tab-pane v-if="admin" name="identities" tab="身份" :tab-props="tabProps('identities')" v-bind="panelProps('identities')"><div class="toolbar"><n-button type="primary" :disabled="loading" @click="identityForm"><template #icon><Plus :size="16" /></template>创建身份</n-button></div><DataGrid :rows="identities" :loading="loading" :columns="[{ key: 'id', title: '身份编码', width: 220 }, { key: 'enabled', title: '启用', width: 90 }, { key: 'created_at', title: '创建时间', width: 230 }]" :actions="row => row.enabled ? [{ label: '撤销', danger: true, run: () => revoke(row) }] : []" /></n-tab-pane>
    <n-tab-pane name="sources" tab="来源归属" :tab-props="tabProps('sources')" v-bind="panelProps('sources')"><n-empty v-if="!project" description="暂无可访问的项目" /><template v-else><div v-if="admin" class="toolbar"><n-button :disabled="loading" @click="bindSource">分配来源</n-button></div><DataGrid :rows="sources" :loading="loading" :columns="[{ key: 'code', title: '来源编码' }, { key: 'source_type', title: '类型' }]" /></template></n-tab-pane>
    <n-tab-pane v-if="owner" name="members" tab="项目成员" :tab-props="tabProps('members')" v-bind="panelProps('members')"><div class="toolbar"><n-button type="primary" :disabled="loading" @click="memberForm()"><template #icon><Plus :size="16" /></template>添加成员</n-button></div><DataGrid :rows="members" :loading="loading" :columns="[{ key: 'identity_id', title: '身份' }, { key: 'role', title: '角色' }, { key: 'enabled', title: '启用', width: 90 }]" :actions="row => [{ label: '修改角色', run: () => memberForm(row) }]" /></n-tab-pane>
  </n-tabs></section>
  <n-modal v-model:show="modal" preset="card" class="action-modal" :title="modalTitle" :mask-closable="!loading" :closable="!loading"><n-alert v-if="error" type="error" class="section-gap">{{ error }}</n-alert><ActionForm :key="modalTitle + JSON.stringify(initial)" :fields="fields" :initial="initial" :busy="loading" submit-label="确认提交" @submit="save" /></n-modal>
  <n-modal :show="!!issuedToken" preset="card" class="connection-modal" :title="`身份令牌 · ${issuedIdentity}`" :mask-closable="false" @update:show="issuedToken = ''"><n-input :value="issuedToken" type="password" show-password-on="click" readonly :input-props="{ 'aria-label': '新身份令牌' }" /><div class="toolbar"><n-button type="primary" @click="issuedToken = ''">关闭</n-button></div></n-modal>
</template>
