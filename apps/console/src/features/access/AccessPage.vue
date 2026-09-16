<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  NAlert,
  NButton,
  NEmpty,
  NModal,
  NTabs,
  NTabPane,
  NInput,
  useDialog,
  useMessage,
} from 'naive-ui'
import { Plus } from 'lucide-vue-next'
import { useConsoleContext } from '../../app/context'
import { useApi } from '../../shared/composables/useApi'
import { useTabs } from '../../shared/composables/useTabs'
import type { Action, Column } from '../../shared/types'
import DataGrid from '../../shared/components/DataGrid.vue'
import { accessApi } from './api'
import type { Identity, Member, MemberInput, ProjectInput, ProjectSource } from './api'
import ProjectForm from './ProjectForm.vue'
import IdentityForm from './IdentityForm.vue'
import MemberForm from './MemberForm.vue'
import SourceBindingForm from './SourceBindingForm.vue'

const { session, loadProjects, projects: projectStore } = useConsoleContext()
const { owner, projectId, projects } = storeToRefs(projectStore)
const project = projectId.value
const admin = session.mode === 'admin'
const { loading, error, run, call } = useApi()
const api = accessApi(call, project)
const dialog = useDialog()
const message = useMessage()
const { activeTab, tabProps, panelProps } = useTabs(admin ? 'projects' : 'sources')
const identities = ref<Identity[]>([])
const members = ref<Member[]>([])
const sources = ref<ProjectSource[]>([])
const modal = ref(false)
const title = ref('')
const operation = ref<'project' | 'identity' | 'member' | 'source'>('project')
const selected = ref<Member | null>(null)
const issuedToken = ref('')
const issuedIdentity = ref('')
onScopeDispose(() => {
  dialog.destroyAll()
  issuedToken.value = ''
})
const projectColumns: Column[] = [
  { key: 'code', title: '编码' },
  { key: 'name', title: '名称' },
  { key: 'description', title: '说明', width: 300 },
]
const identityColumns: Column[] = [
  { key: 'id', title: '身份编码', width: 220 },
  { key: 'enabled', title: '启用', width: 90 },
  { key: 'created_at', title: '创建时间', width: 230 },
]
const sourceColumns: Column[] = [
  { key: 'code', title: '来源编码' },
  { key: 'source_type', title: '类型' },
]
const memberColumns: Column[] = [
  { key: 'identity_id', title: '身份' },
  { key: 'role', title: '角色' },
  { key: 'enabled', title: '启用', width: 90 },
]
async function load() {
  if (admin) {
    identities.value = await api.identities()
  }
  if (project) {
    sources.value = await api.sources()
    if (owner.value) {
      members.value = await api.members()
    }
  }
}
function open(kind: typeof operation.value, heading: string, member: Member | null = null) {
  operation.value = kind
  title.value = heading
  selected.value = member
  error.value = ''
  modal.value = true
}
function save(action: () => Promise<unknown>) {
  void run(async () => {
    await action()
    modal.value = false
    message.success('操作已提交')
    await load()
    await loadProjects()
  })
}
function saveProject(input: ProjectInput) {
  save(() => api.project(input))
}
function saveMember(input: MemberInput) {
  save(() => api.member(input))
}
function bindSource(code: string) {
  save(() => api.bind(code))
}
function createIdentity(id: string) {
  save(async () => {
    const result = await api.identity(id)
    issuedIdentity.value = result.id
    issuedToken.value = result.token
  })
}
function identityActions(row: Identity): Action[] {
  return row.enabled
    ? [
        {
          label: '撤销',
          danger: true,
          run: () => {
            dialog.warning({
              title: '撤销身份',
              content: `身份 ${row.id} 将立即失去访问权限。`,
              positiveText: '确认撤销',
              negativeText: '返回',
              onPositiveClick: () =>
                run(async () => {
                  await api.revoke(row.id)
                  await load()
                }),
            })
          },
        },
      ]
    : []
}
function memberActions(row: Member): Action[] {
  return [{ label: '修改角色', run: () => open('member', '保存成员角色', row) }]
}
onMounted(() => run(load))
</script>
<template>
  <NAlert v-if="error && !modal" type="error" class="section-gap">
    {{ error }}
  </NAlert>
  <section class="section">
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane
        v-if="admin"
        name="projects"
        tab="项目"
        :tab-props="tabProps('projects')"
        v-bind="panelProps('projects')"
      >
        <div class="toolbar">
          <NButton
            type="primary"
            :disabled="loading"
            @click="open('project', '创建项目')"
          >
            <template #icon>
              <Plus :size="16" />
            </template>创建项目
          </NButton>
        </div>
        <DataGrid
          :rows="projects"
          :loading="loading"
          :columns="projectColumns"
        />
      </NTabPane>
      <NTabPane
        v-if="admin"
        name="identities"
        tab="身份"
        :tab-props="tabProps('identities')"
        v-bind="panelProps('identities')"
      >
        <div class="toolbar">
          <NButton
            type="primary"
            :disabled="loading"
            @click="open('identity', '创建身份')"
          >
            <template #icon>
              <Plus :size="16" />
            </template>创建身份
          </NButton>
        </div>
        <DataGrid
          :rows="identities"
          :loading="loading"
          :columns="identityColumns"
          :actions="identityActions"
        />
      </NTabPane>
      <NTabPane
        name="sources"
        tab="来源归属"
        :tab-props="tabProps('sources')"
        v-bind="panelProps('sources')"
      >
        <NEmpty v-if="!project" description="暂无可访问的项目" /><template v-else>
          <div v-if="admin" class="toolbar">
            <NButton :disabled="loading" @click="open('source', '分配来源')">
              分配来源
            </NButton>
          </div>
          <DataGrid :rows="sources" :loading="loading" :columns="sourceColumns" />
        </template>
      </NTabPane>
      <NTabPane
        v-if="owner"
        name="members"
        tab="项目成员"
        :tab-props="tabProps('members')"
        v-bind="panelProps('members')"
      >
        <div class="toolbar">
          <NButton
            type="primary"
            :disabled="loading"
            @click="open('member', '保存成员角色')"
          >
            <template #icon>
              <Plus :size="16" />
            </template>添加成员
          </NButton>
        </div>
        <DataGrid
          :rows="members"
          :loading="loading"
          :columns="memberColumns"
          :actions="memberActions"
        />
      </NTabPane>
    </NTabs>
  </section>
  <NModal
    v-model:show="modal"
    preset="card"
    class="action-modal"
    :title="title"
    :mask-closable="!loading"
    :closable="!loading"
  >
    <NAlert v-if="error" type="error" class="section-gap">
      {{ error }}
    </NAlert>
    <ProjectForm v-if="operation === 'project'" :busy="loading" @submit="saveProject" />
    <IdentityForm v-else-if="operation === 'identity'" :busy="loading" @submit="createIdentity" />
    <MemberForm
      v-else-if="operation === 'member'"
      :member="selected"
      :busy="loading"
      @submit="saveMember"
    />
    <SourceBindingForm v-else :busy="loading" @submit="bindSource" />
  </NModal>
  <NModal
    :show="!!issuedToken"
    preset="card"
    class="connection-modal"
    :title="`身份令牌 · ${issuedIdentity}`"
    :mask-closable="false"
    @update:show="issuedToken = ''"
  >
    <NInput
      :value="issuedToken"
      type="password"
      show-password-on="click"
      readonly
      :input-props="{ 'aria-label': '新身份令牌' }"
    />
    <div class="toolbar">
      <NButton type="primary" @click="issuedToken = ''">
        关闭
      </NButton>
    </div>
  </NModal>
</template>
