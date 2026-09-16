<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NEmpty } from 'naive-ui'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '../../stores/project'
import { useApi } from '../../shared/composables/useApi'
import type { Action, Column } from '../../shared/types'
import { assetApi } from './api'
import type { Asset } from './api'
import DataGrid from '../../shared/components/DataGrid.vue'
import DetailDrawer from '../../shared/components/DetailDrawer.vue'
const { loading, error, run, call } = useApi()
const { projectId } = storeToRefs(useProjectStore())
const project = projectId.value
const api = assetApi(call, project ?? 0)
const rows = ref<Asset[]>([])
const offset = ref(0)
const detail = ref<unknown>()
const showDetail = ref(false)
const title = ref('资产详情')
async function load(next = 0) {
  if (project) {
    await run(async () => {
      rows.value = await api.list(next)
      offset.value = next
    })
  }
}
function inspect(row: Asset, coverage = false) {
  void run(async () => {
    detail.value = await (coverage ? api.coverage(row.run_id) : api.detail(row.id))
    title.value = coverage ? '批次覆盖' : '结构与来源'
    showDetail.value = true
  })
}
const columns: Column[] = [
  { key: 'name', title: '资产名称', width: 210 },
  { key: 'source_code', title: '来源' },
  { key: 'kind', title: '类型', width: 100 },
  { key: 'state', title: '状态', state: true },
  { key: 'row_count', title: '行数', width: 100 },
  { key: 'data_window', title: '窗口', width: 220 },
  { key: 'contract_version', title: '契约版本', width: 100 },
]
function actions(row: Asset): Action[] {
  const items: Action[] = [{ label: '结构与来源', run: () => inspect(row) }]
  if (row.kind === 'TABLE') {
    items.push({ label: '批次覆盖', run: () => inspect(row, true) })
  }
  return items
}
onMounted(() => load())
</script>
<template>
  <NAlert v-if="error" type="error" class="section-gap">
    {{ error }}
  </NAlert>
  <NEmpty v-if="!project" description="暂无可访问的项目" />
  <section v-else class="section">
    <div class="section-head">
      <h2>资产版本</h2>
      <span class="muted">{{ rows.length }} 条 / 第 {{ offset / 100 + 1 }} 页</span>
    </div>
    <DataGrid
      :rows="rows"
      :loading="loading"
      :paginated="false"
      :columns="columns"
      :actions="actions"
    />
    <div class="pager">
      <NButton :disabled="loading || offset === 0" @click="load(offset - 100)">
        <template #icon>
          <ChevronLeft :size="16" />
        </template>上一页
      </NButton><NButton
        :disabled="loading || rows.length < 100 || offset >= 1000000"
        @click="load(offset + 100)"
      >
        下一页<template #icon>
          <ChevronRight :size="16" />
        </template>
      </NButton>
    </div>
  </section>
  <DetailDrawer v-model:show="showDetail" :title="title" :value="detail" />
</template>
