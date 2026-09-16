<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { NAlert, NButton, NEmpty, NSelect, NTabPane, NTabs, NTag, useDialog } from 'naive-ui'
import { Plus } from 'lucide-vue-next'
import { useProjectStore } from '../../stores/project'
import { useApi } from '../../shared/composables/useApi'
import { useTabs } from '../../shared/composables/useTabs'
import type { Dataset } from '../../shared/types'
import type { Build, ModelVersion, Release } from './types'
import { datasetApi } from './api'
import DetailDrawer from '../../shared/components/DetailDrawer.vue'
import DatasetActions from './components/DatasetActions.vue'
import ModelVersionsPanel from './components/ModelVersionsPanel.vue'
import BuildsPanel from './components/BuildsPanel.vue'
import ReleaseHistoryPanel from './components/ReleaseHistoryPanel.vue'
import QueryPanel from './components/QueryPanel.vue'

const { projectId, engineer, owner } = storeToRefs(useProjectStore())
const project = projectId.value
const { call, loading, error, run } = useApi()
const api = datasetApi(call, project ?? 0)
const dialog = useDialog()
onScopeDispose(() => dialog.destroyAll())
const datasets = ref<Dataset[]>([])
const datasetId = ref<number | null>(null)
const versions = ref<ModelVersion[]>([])
const builds = ref<Build[]>([])
const releases = ref<Release[]>([])
const queryRevision = ref(0)
const selected = computed(() => datasets.value.find(item => item.id === datasetId.value))
const options = computed(() => datasets.value.map(item => ({ label: item.name, value: item.id })))
const { activeTab, tabProps, panelProps } = useTabs('query')
const detail = ref<unknown>()
const detailTitle = ref('详情')
const showDetail = ref(false)
const actions = ref<InstanceType<typeof DatasetActions> | null>(null)

async function loadDataset() {
  versions.value = []
  builds.value = []
  releases.value = []
  queryRevision.value++
  showDetail.value = false
  detail.value = undefined
  if (!datasetId.value) {
    return
  }
  const id = datasetId.value
  const [nextVersions, nextReleases, nextBuilds] = await Promise.all([
    api.versions(id),
    api.releases(id),
    engineer.value ? api.builds(id) : Promise.resolve([]),
  ])
  versions.value = nextVersions
  releases.value = nextReleases
  builds.value = nextBuilds
}
async function load() {
  if (!project) {
    return
  }
  datasets.value = await api.list()
  if (!datasets.value.some(item => item.id === datasetId.value)) {
    datasetId.value = datasets.value[0]?.id ?? null
  }
  await loadDataset()
}
function saved(id: number | null) {
  if (id) {
    datasetId.value = id
  }
  void run(load)
}
function inspect(title: string, value: unknown) {
  detailTitle.value = title
  detail.value = value
  showDetail.value = true
}
function register(version?: ModelVersion) {
  actions.value?.register(selected.value ?? null, version)
}
function build() {
  if (selected.value) {
    actions.value?.build(selected.value, versions.value)
  }
}
function publish(id: number) {
  if (selected.value) {
    actions.value?.publish(selected.value, id)
  }
}
function policy() {
  if (selected.value) {
    actions.value?.policy(selected.value)
  }
}
function impact(version: number) {
  const id = datasetId.value
  if (id) {
    void run(async () => inspect('变更影响', await api.impact(id, version)))
  }
}
function cancel(buildId: number) {
  const id = datasetId.value
  if (!id) {
    return
  }
  dialog.warning({
    title: '取消模型构建',
    content: `构建 #${buildId}`,
    positiveText: '确认取消',
    negativeText: '返回',
    onPositiveClick: () =>
      run(async () => {
        await api.cancel(id, buildId)
        await load()
      }),
  })
}
onMounted(() => run(load))
</script>

<template>
  <NAlert v-if="error" type="error" class="section-gap">
    {{ error }}
  </NAlert>
  <NEmpty v-if="!project" description="暂无可访问的项目" />
  <template v-else>
    <div class="dataset-bar">
      <NSelect
        v-model:value="datasetId"
        :options="options"
        placeholder="选择数据集"
        :input-props="{ 'aria-label': '当前数据集' }"
        :disabled="loading"
        filterable
        @update:value="run(loadDataset)"
      />
      <NTag v-if="selected" :bordered="false">
        模型 v{{ selected.active_model_version }}
      </NTag>
      <NTag
        v-if="selected?.active_release_id"
        type="success"
        :bordered="false"
      >
        Release {{ selected.active_release_id }}
      </NTag>
      <NButton
        v-if="engineer"
        type="primary"
        :disabled="loading"
        @click="register()"
      >
        <template #icon>
          <Plus :size="16" />
        </template>登记模型
      </NButton>
    </div>
    <NEmpty v-if="!datasetId && !loading" description="暂无数据集" />
    <section v-if="datasetId" class="section">
      <NTabs v-model:value="activeTab" type="line">
        <NTabPane
          name="query"
          tab="数据查询"
          :tab-props="tabProps('query')"
          v-bind="panelProps('query')"
        >
          <QueryPanel
            :key="`${datasetId}-${queryRevision}`"
            :project="project"
            :dataset="datasetId"
          />
        </NTabPane>
        <NTabPane
          name="versions"
          tab="模型版本"
          :tab-props="tabProps('versions')"
          v-bind="panelProps('versions')"
        >
          <ModelVersionsPanel
            :rows="versions"
            :loading="loading"
            :engineer="engineer"
            @detail="inspect('模型契约', $event)"
            @register="register"
            @impact="impact"
          />
        </NTabPane>
        <NTabPane
          v-if="engineer"
          name="builds"
          tab="构建与质量"
          :tab-props="tabProps('builds')"
          v-bind="panelProps('builds')"
        >
          <BuildsPanel
            :rows="builds"
            :loading="loading"
            :can-build="!!versions.length"
            :owner="owner"
            @detail="inspect('质量与依赖', $event)"
            @create="build"
            @publish="publish"
            @cancel="cancel"
          />
        </NTabPane>
        <NTabPane
          name="releases"
          tab="发布历史"
          :tab-props="tabProps('releases')"
          v-bind="panelProps('releases')"
        >
          <ReleaseHistoryPanel
            :rows="releases"
            :loading="loading"
            @detail="inspect('发布详情', $event)"
          />
        </NTabPane>
        <NTabPane
          v-if="owner"
          name="policy"
          tab="行列授权"
          :tab-props="tabProps('policy')"
          v-bind="panelProps('policy')"
        >
          <NButton :disabled="loading" @click="policy">
            配置数据授权
          </NButton>
        </NTabPane>
      </NTabs>
    </section>
    <DatasetActions ref="actions" :project="project" @saved="saved" />
  </template>
  <DetailDrawer v-model:show="showDetail" :title="detailTitle" :value="detail" />
</template>

<style scoped src="./DatasetsPage.css" />
