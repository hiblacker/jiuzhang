<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, NButton, NSelect, NInput, NModal, NForm, NFormItem, NAlert, NTag, NTooltip, zhCN, dateZhCN } from 'naive-ui'
import { Activity, Database, CalendarClock, ListChecks, Files, Workflow, Users, RefreshCw, LogOut, PanelLeft, PlugZap } from 'lucide-vue-next'
import { disconnect, errorText, loadProjects, project, projectId, projects, session, validateBase } from './api'
const OverviewView = defineAsyncComponent(() => import('./views/OverviewView.vue'))
const IngestionView = defineAsyncComponent(() => import('./views/IngestionView.vue'))
const AssetsView = defineAsyncComponent(() => import('./views/AssetsView.vue'))
const ModelsView = defineAsyncComponent(() => import('./views/ModelsView.vue'))
const AccessView = defineAsyncComponent(() => import('./views/AccessView.vue'))
const routes = [
  { key: 'overview', label: '运行概览', icon: Activity, admin: true },
  { key: 'sources', label: '数据来源', icon: Database, admin: true },
  { key: 'plans', label: '接入计划', icon: CalendarClock, admin: true },
  { key: 'runs', label: '执行与交付', icon: ListChecks, admin: true },
  { key: 'assets', label: '资产目录', icon: Files, admin: false },
  { key: 'models', label: '模型与数据集', icon: Workflow, admin: false },
  { key: 'access', label: '项目权限', icon: Users, admin: false },
]
const route = ref(window.location.hash.slice(1) || 'overview')
const refreshKey = ref(0), mobileMenu = ref(false), connecting = ref(false), connectionError = ref(''), login = ref(true)
const refreshing = ref(false)
const base = ref(import.meta.env.VITE_API_BASE_URL || window.location.origin), token = ref(''), mode = ref('admin')
const visibleRoutes = computed(() => routes.filter(r => !r.admin || session.mode === 'admin'))
const currentRoute = computed(() => visibleRoutes.value.find(r => r.key === route.value) ?? visibleRoutes.value[0]!)
const projectScoped = computed(() => ['assets', 'models', 'access'].includes(currentRoute.value.key))
function navigate(key: string) { window.location.hash = key; route.value = key; mobileMenu.value = false }
function hashChanged() { route.value = window.location.hash.slice(1) }
onMounted(() => window.addEventListener('hashchange', hashChanged))
onUnmounted(() => window.removeEventListener('hashchange', hashChanged))
watch(() => session.connected, connected => { if (!connected) { login.value = true; token.value = '' } })
async function connect() {
  if (connecting.value) return
  connectionError.value = ''
  try {
    const url = validateBase(base.value)
    if (!token.value.trim()) throw new Error('请输入访问令牌')
    disconnect(); connecting.value = true
    session.base = url; session.token = token.value.trim(); session.mode = mode.value
    await loadProjects()
    session.connected = true; login.value = false; token.value = ''
    navigate(mode.value === 'admin' ? 'overview' : 'assets')
  } catch (e) { connectionError.value = errorText(e); disconnect() }
  finally { connecting.value = false }
}
async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  const generation = session.generation
  connectionError.value = ''
  try { await loadProjects(); if (generation === session.generation) refreshKey.value++ }
  catch (e) { if (generation === session.generation || !session.connected) connectionError.value = errorText(e) }
  finally { refreshing.value = false }
}
const theme = { common: { primaryColor: '#167d65', primaryColorHover: '#116d58', primaryColorPressed: '#0b5947', borderRadius: '4px', fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif' } }
</script>
<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="theme">
    <n-message-provider><n-dialog-provider>
      <div class="app-shell">
        <aside class="sidebar" :class="{ expanded: mobileMenu }">
          <div class="brand"><span class="brand-mark"><Database :size="23" /></span><div><strong>九章</strong><small>JIUZHANG</small></div></div>
          <div class="nav-caption">数据工作台</div>
          <nav aria-label="主导航"><button v-for="item in visibleRoutes" :key="item.key" :class="{ active: currentRoute.key === item.key }" :aria-current="currentRoute.key === item.key ? 'page' : undefined" @click="navigate(item.key)"><component :is="item.icon" :size="18" /><span>{{ item.label }}</span></button></nav>
          <div class="sidebar-bottom"><span class="connection-dot" :class="{ online: session.connected }"></span>{{ session.connected ? '控制 API 已连接' : '未连接' }}<small>CONSOLE 0.2.0</small></div>
        </aside>
        <div class="workspace">
          <header class="topbar">
            <n-button class="menu-toggle" quaternary circle aria-label="打开导航" @click="mobileMenu = !mobileMenu"><PanelLeft :size="19" /></n-button>
            <span class="breadcrumb">数据平台 <span>/</span> {{ currentRoute.label }}</span>
            <div class="topbar-actions"><n-tag :bordered="false" size="small">{{ session.mode === 'admin' ? '平台管理' : '项目成员' }}</n-tag>
              <n-tooltip><template #trigger><n-button quaternary circle aria-label="重新连接" @click="disconnect(); login = true"><component :is="session.connected ? LogOut : PlugZap" :size="18" /></n-button></template>重新连接</n-tooltip>
            </div>
          </header>
          <main>
            <div class="page-heading"><div><div class="eyebrow">JIUZHANG / WORKSPACE</div><h1>{{ currentRoute.label }}</h1></div><n-button :disabled="!session.connected" :loading="refreshing" @click="refresh"><template #icon><RefreshCw :size="16" /></template>刷新</n-button></div>
            <n-alert v-if="connectionError && !login" type="error" class="section-gap">{{ connectionError }}</n-alert>
            <div v-if="session.connected && projectScoped" class="project-bar"><label for="project-picker">当前项目</label><n-select :value="projectId" :options="projects.map(p => ({ label: p.name, value: p.id }))" :input-props="{ id: 'project-picker', 'aria-label': '当前项目' }" filterable @update:value="projectId = $event" /><n-tag v-if="project" :bordered="false" size="small">{{ project.role }}</n-tag></div>
            <template v-if="session.connected">
              <OverviewView v-if="currentRoute.key === 'overview'" :key="`overview-${refreshKey}-${session.generation}`" />
              <IngestionView v-else-if="['sources', 'plans', 'runs'].includes(currentRoute.key)" :key="`${currentRoute.key}-${refreshKey}-${session.generation}`" :view="currentRoute.key" />
              <AssetsView v-else-if="currentRoute.key === 'assets'" :key="`assets-${projectId}-${refreshKey}-${session.generation}`" />
              <ModelsView v-else-if="currentRoute.key === 'models'" :key="`models-${projectId}-${refreshKey}-${session.generation}`" />
              <AccessView v-else :key="`access-${projectId}-${refreshKey}-${session.generation}`" />
            </template>
            <div v-else class="disconnected"><Database :size="42" /><h2>九章数据平台</h2><n-button type="primary" @click="login = true">连接工作台</n-button></div>
          </main>
          <footer>九章 · 数据平台<span>Asia/Shanghai</span></footer>
        </div>
      </div>
      <n-modal v-model:show="login" preset="card" title="连接工作台" class="connection-modal" :mask-closable="false" :closable="false" :close-on-esc="false">
        <n-alert v-if="connectionError" type="error" class="section-gap">{{ connectionError }}</n-alert>
        <n-form label-placement="top" @submit.prevent="connect">
          <n-form-item label="控制 API 地址" :label-props="{ for: 'base-url' }"><n-input v-model:value="base" :disabled="connecting" :input-props="{ id: 'base-url', autocomplete: 'url' }" /></n-form-item>
          <n-form-item label="访问令牌" :label-props="{ for: 'token' }"><n-input v-model:value="token" type="password" show-password-on="click" :disabled="connecting" :input-props="{ id: 'token', autocomplete: 'off' }" /></n-form-item>
          <n-form-item label="访问视图" :label-props="{ for: 'access-mode' }"><n-select v-model:value="mode" filterable :options="[{ label: '平台管理', value: 'admin' }, { label: '项目成员', value: 'project' }]" :input-props="{ id: 'access-mode', 'aria-label': '访问视图' }" :disabled="connecting" /></n-form-item>
          <n-button type="primary" attr-type="submit" block :loading="connecting">连接</n-button>
        </n-form>
      </n-modal>
    </n-dialog-provider></n-message-provider>
  </n-config-provider>
</template>
