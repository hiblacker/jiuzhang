<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { NAlert, NButton, NSelect, NTag } from 'naive-ui'
import { Database, RefreshCw } from 'lucide-vue-next'
import { useConsoleContext } from './context'
import { useNavigation } from './navigation'
import { errorText } from '../shared/errors'
import type { AccessMode } from '../stores/session'
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'
import ConnectionDialog from './ConnectionDialog.vue'

const pages = {
  overview: defineAsyncComponent(() => import('../features/overview/OverviewPage.vue')),
  sources: defineAsyncComponent(() => import('../features/sources/SourcesPage.vue')),
  plans: defineAsyncComponent(() => import('../features/plans/PlansPage.vue')),
  runs: defineAsyncComponent(() => import('../features/executions/ExecutionsPage.vue')),
  assets: defineAsyncComponent(() => import('../features/assets/AssetsPage.vue')),
  models: defineAsyncComponent(() => import('../features/datasets/DatasetsPage.vue')),
  access: defineAsyncComponent(() => import('../features/access/AccessPage.vue')),
}
const context = useConsoleContext()
const { session } = context
const { project, projectId, projects, generation } = storeToRefs(context.projects)
const projectOptions = computed(() =>
  projects.value.map(item => ({ label: item.name, value: item.id })),
)
const { currentRoute, visibleRoutes, mobileMenu, navigate } = useNavigation()
const page = computed(() => pages[currentRoute.value.key as keyof typeof pages])
const refreshKey = ref(0)
const refreshing = ref(false)
const error = ref('')
const pageKey = computed(
  () => `${currentRoute.value.key}-${generation.value}-${session.generation}-${refreshKey.value}`,
)
function connected(mode: AccessMode) {
  error.value = ''
  navigate(mode === 'admin' ? 'overview' : 'assets')
}
async function refresh() {
  if (refreshing.value) {
    return
  }
  refreshing.value = true
  const revision = session.generation
  error.value = ''
  try {
    await context.loadProjects()
    if (revision === session.generation) {
      refreshKey.value++
    }
  }
  catch (cause) {
    if (revision === session.generation) {
      error.value = errorText(cause)
    }
  }
  finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar
      :items="visibleRoutes"
      :current="currentRoute.key"
      :expanded="mobileMenu"
      :connected="session.connected"
      @navigate="navigate"
    />
    <div class="workspace">
      <AppTopbar
        :title="currentRoute.label"
        :mode="session.mode"
        :connected="session.connected"
        @menu="mobileMenu = !mobileMenu"
        @reconnect="context.disconnect"
      />
      <main class="app-main">
        <div class="page-heading">
          <div>
            <div class="eyebrow">
              JIUZHANG / WORKSPACE
            </div>
            <h1>{{ currentRoute.label }}</h1>
          </div>
          <NButton :disabled="!session.connected" :loading="refreshing" @click="refresh">
            <template #icon>
              <RefreshCw :size="16" />
            </template>刷新
          </NButton>
        </div>
        <NAlert v-if="error" type="error" class="section-gap">
          {{ error }}
        </NAlert>
        <div v-if="session.connected && currentRoute.project" class="project-bar">
          <label for="project-picker">当前项目</label><NSelect
            :value="projectId"
            :options="projectOptions"
            :input-props="{ id: 'project-picker', 'aria-label': '当前项目' }"
            filterable
            @update:value="context.projects.select"
          /><NTag v-if="project" :bordered="false" size="small">
            {{ project.role }}
          </NTag>
        </div>
        <component :is="page" v-if="session.connected" :key="pageKey" />
        <div v-else class="disconnected">
          <Database :size="42" />
          <h2>九章数据平台</h2>
        </div>
      </main>
      <footer class="app-footer">
        九章 · 数据平台<span>Asia/Shanghai</span>
      </footer>
    </div>
  </div>
  <ConnectionDialog v-if="!session.connected" @connected="connected" />
</template>

<style scoped src="./AppShell.css" />
