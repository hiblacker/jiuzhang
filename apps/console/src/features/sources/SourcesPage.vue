<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NModal, useMessage } from 'naive-ui'
import { Plus, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import DataGrid from '../../shared/components/DataGrid.vue'
import { useApi } from '../../shared/composables/useApi'
import type { Column, Source } from '../../shared/types'
import { sourceApi } from './api'
import type { SourceInput } from './api'
import SourceForm from './SourceForm.vue'

const { call, loading, error, run } = useApi()
const api = sourceApi(call)
const message = useMessage()
const rows = ref<Source[]>([])
const page = ref(0)
const modal = ref(false)
const columns: Column[] = [
  { key: 'code', title: '来源编码', width: 230 },
  { key: 'sourceType', title: '类型' },
  { key: 'state', title: '状态', state: true },
  { key: 'createdAt', title: '创建时间', width: 230 },
]
async function load(next = page.value) {
  rows.value = (await api.list(next * 50)).items
  page.value = next
}
function save(input: SourceInput) {
  void run(async () => {
    await api.register(input)
    modal.value = false
    message.success('操作已提交')
    await load()
  })
}
onMounted(() => run(load))
</script>
<template>
  <NAlert v-if="error && !modal" type="error" class="section-gap">
    {{ error }}
  </NAlert>
  <section class="section">
    <div class="section-head">
      <h2>已登记来源</h2>
      <NButton type="primary" :disabled="loading" @click="modal = true">
        <template #icon>
          <Plus :size="16" />
        </template>登记来源
      </NButton>
    </div>
    <DataGrid
      :rows="rows"
      :columns="columns"
      :loading="loading"
      :paginated="false"
    />
    <div class="pager">
      <span class="muted">第 {{ page + 1 }} 页</span><NButton :disabled="loading || page === 0" @click="run(() => load(page - 1))">
        <template #icon>
          <ChevronLeft :size="16" />
        </template>上一页
      </NButton><NButton :disabled="loading || rows.length < 50" @click="run(() => load(page + 1))">
        下一页<template #icon>
          <ChevronRight :size="16" />
        </template>
      </NButton>
    </div>
  </section>
  <NModal
    v-model:show="modal"
    preset="card"
    class="action-modal"
    title="登记来源"
    :mask-closable="!loading"
    :closable="!loading"
  >
    <NAlert v-if="error" type="error" class="section-gap">
      {{ error }}
    </NAlert><SourceForm :busy="loading" @submit="save" />
  </NModal>
</template>
