<script setup lang="ts">
import { computed, h } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NInput,
  NLayout,
  NLayoutSider,
  NMenu,
  NModal,
  NPagination,
  NSpace,
} from 'naive-ui';
import { RouterView, useRoute, useRouter } from 'vue-router';
import type { Project } from '@/api';
import { appRoutes } from '@/router/routes';
import {
  canIngest,
  canManage,
  identify,
  isAdmin,
  loadProjects,
  role,
  selectProject,
  session,
  signOut,
} from '@/stores/session';

const route = useRoute();
const router = useRouter();

// The sidebar is derived from the route table, so a page and its menu entry cannot drift apart.
const menuOptions = computed(() =>
  appRoutes
    .filter((item) => item.meta?.menu)
    .filter((item) => !item.meta?.roles || item.meta.roles.includes(role.value ?? ''))
    .map((item) => ({ key: `/${item.path}`, label: String(item.meta?.title ?? item.path) })),
);
const heading = computed(() => route.meta.title ?? '');
const projectColumns = [
  { title: '项目', key: 'name' },
  { title: '编码', key: 'code' },
  { title: '角色', key: 'role' },
  {
    title: '操作',
    key: 'actions',
    render: (project: Project) => h(NButton, { text: true, onClick: () => selectProject(project) }, () => '进入项目'),
  },
];

// P1 keeps the existing view contracts; P2 replaces this shim with stores inside the views.
const pageProps = computed(() => {
  const project = session.project?.id ?? null;
  const identity = session.identity?.identity;
  switch (route.name) {
    case 'systems':
      return { project, canManage: canManage.value, canIngest: canIngest.value };
    case 'models':
    case 'datasets':
      return { project, canManage: canManage.value };
    case 'runs':
      return {
        project,
        canManage: canManage.value,
        canOperate: canManage.value || canIngest.value,
        identity,
      };
    default:
      return { project };
  }
});

function go(key: string) {
  void router.push(key);
}
function openProjectPicker() {
  session.projectModal = true;
  session.projectPage = 1;
  void searchProjects();
}
async function searchProjects() {
  try {
    await loadProjects();
  } catch (error) {
    session.error = (error as Error).message;
  }
}
async function onSignOut() {
  await signOut();
  await router.push({ name: 'login' });
}
async function onProjectsChanged() {
  try {
    await identify();
  } catch (error) {
    session.error = (error as Error).message;
  }
}
async function onNavigate(key: string) {
  await router.push(`/${key}`);
}
</script>

<template>
  <n-layout has-sider class="workspace">
    <n-layout-sider bordered :width="220" class="sidebar">
      <div class="brand">九章 <small>数据平台</small></div>
      <n-menu :value="route.path" :options="menuOptions" @update:value="go" />
    </n-layout-sider>
    <n-layout content-style="padding: 28px 36px">
      <header>
        <div>
          <h1>{{ heading }}</h1>
          <span class="muted">{{ session.identity?.identity }} · {{ isAdmin ? '平台管理员' : role }}</span>
        </div>
        <n-space align="center">
          <n-button @click="openProjectPicker">{{ session.project?.name || '选择项目' }}</n-button>
          <n-button @click="onSignOut">退出</n-button>
        </n-space>
      </header>
      <n-alert v-if="session.error" type="error" class="gap">{{ session.error }}</n-alert>
      <n-empty v-if="!session.project && !isAdmin" description="尚未加入项目，请联系项目负责人" />
      <n-card v-else-if="!session.project" title="还没有可用的项目" class="gap">
        <p class="muted">平台管理员需要先选择或创建一个项目，页面数据都挂在项目下。</p>
        <n-button type="primary" @click="openProjectPicker">选择项目</n-button>
      </n-card>
      <RouterView v-else v-slot="{ Component }">
        <component :is="Component" v-bind="pageProps" @navigate="onNavigate" @projects-changed="onProjectsChanged" />
      </RouterView>
    </n-layout>
  </n-layout>
  <n-modal v-model:show="session.projectModal" preset="card" title="选择项目" style="width: min(820px, 96vw)">
    <n-space class="gap">
      <n-input
        v-model:value="session.projectSearch"
        placeholder="按项目名称或编码搜索"
        @keyup.enter="
          session.projectPage = 1;
          searchProjects();
        "
      />
      <n-button
        @click="
          session.projectPage = 1;
          searchProjects();
        "
        >搜索</n-button
      >
    </n-space>
    <n-data-table :columns="projectColumns" :data="session.projects" />
    <n-pagination v-model:page="session.projectPage" :item-count="session.projectTotal" :page-size="25" class="gap" />
  </n-modal>
</template>
