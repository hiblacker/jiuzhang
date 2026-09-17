<script setup lang="ts">
import { computed, h, watch } from 'vue';
import {
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
import { notify } from '@/composables/notify';
import { usePermissionStore } from '@/stores/permission';
import { useProjectStore } from '@/stores/project';
import { useSessionStore } from '@/stores/session';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const project = useProjectStore();
const permission = usePermissionStore();

// The sidebar is derived from the route table, so a page and its menu entry cannot drift apart.
const menuOptions = computed(() =>
  appRoutes
    .filter((item) => item.meta?.menu)
    .filter((item) => !item.meta?.roles || item.meta.roles.includes(permission.role ?? ''))
    .map((item) => ({ key: `/${item.path}`, label: String(item.meta?.title ?? item.path) })),
);
const heading = computed(() => route.meta.title ?? '');
watch(
  () => session.error || project.error,
  (message) => {
    if (!message) return;
    notify.error(message);
    session.error = '';
    project.error = '';
  },
);
const projectColumns = [
  { title: '项目', key: 'name' },
  { title: '编码', key: 'code' },
  { title: '角色', key: 'role' },
  {
    title: '操作',
    key: 'actions',
    render: (row: Project) => h(NButton, { text: true, onClick: () => project.select(row) }, () => '进入项目'),
  },
];

function go(key: string) {
  void router.push(key);
}
function searchProjects() {
  project.page = 1;
  void project.load().catch(() => undefined);
}
async function onSignOut() {
  await session.signOut();
  await router.push({ name: 'login' });
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
          <span class="muted"
            >{{ session.identity?.identity }} · {{ session.isAdmin ? '平台管理员' : permission.role }}</span
          >
        </div>
        <n-space align="center">
          <n-button @click="project.openPicker()">{{ project.selected?.name || '选择项目' }}</n-button>
          <n-button @click="onSignOut">退出</n-button>
        </n-space>
      </header>
      <n-empty v-if="!project.selected && !session.isAdmin" description="尚未加入项目，请联系项目负责人" />
      <n-card v-else-if="!project.selected" title="还没有可用的项目" class="gap">
        <p class="muted">平台管理员需要先选择或创建一个项目，页面数据都挂在项目下。</p>
        <n-button type="primary" @click="project.openPicker()">选择项目</n-button>
      </n-card>
      <RouterView v-else />
    </n-layout>
  </n-layout>
  <n-modal v-model:show="project.modal" preset="card" title="选择项目" style="width: min(820px, 96vw)">
    <n-space class="gap">
      <n-input v-model:value="project.search" placeholder="按项目名称或编码搜索" @keyup.enter="searchProjects" />
      <n-button @click="searchProjects">搜索</n-button>
    </n-space>
    <n-data-table :columns="projectColumns" :data="project.items" />
    <n-pagination v-model:page="project.page" :item-count="project.total" :page-size="25" class="gap" />
  </n-modal>
</template>
