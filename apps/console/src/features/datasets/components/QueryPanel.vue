<script setup lang="ts">
import { computed, reactive, useId } from 'vue'
import { NAlert, NButton, NForm, NFormItem, NInput, NInputNumber } from 'naive-ui'
import { ChevronLeft, ChevronRight, Download } from 'lucide-vue-next'
import DataGrid from '../../../shared/components/DataGrid.vue'
import { useApi } from '../../../shared/composables/useApi'
import { columnNames, jsonObject, useFormSubmit } from '../../../shared/forms'
import { datasetApi } from '../api'
import { useDatasetQuery } from '../useDatasetQuery'

const props = defineProps<{ project: number, dataset: number }>()
const id = useId()
const { call, error, run } = useApi()
const { result, loading, query, page, exportPage } = useDatasetQuery(
  datasetApi(call, props.project),
  props.dataset,
)
const draft = reactive({ releaseId: null as number | null, columns: '', limit: 100, equals: '{}' })
const rules = {
  limit: {
    required: true,
    type: 'number' as const,
    min: 1,
    max: 1000,
    message: '每页行数应为 1 到 1000',
  },
}
const { form, validation, validate } = useFormSubmit(() => {
  const equals = jsonObject(draft.equals, '等值筛选')
  const columns = columnNames(draft.columns)
  void run(() =>
    query({
      limit: draft.limit,
      offset: 0,
      equals,
      ...(draft.releaseId ? { releaseId: draft.releaseId } : {}),
      ...(columns.length ? { columns } : {}),
    }),
  )
})
const columns = computed(
  () => result.value?.columns.map(key => ({ key, title: key, width: 180 })) ?? [],
)
function download() {
  void run(async () => {
    const file = await exportPage()
    if (!file) {
      return
    }
    const url = URL.createObjectURL(file.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = file.filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}
</script>

<template>
  <NAlert v-if="error || validation" type="error" class="section-gap">
    {{ error || validation }}
  </NAlert>
  <NForm
    ref="form"
    :model="draft"
    :rules="rules"
    label-placement="top"
    @submit.prevent="validate"
  >
    <div class="form-grid">
      <NFormItem label="发布 ID（留空使用当前版本）" :label-props="{ for: `${id}-release` }">
        <NInputNumber
          v-model:value="draft.releaseId"
          :min="1"
          :precision="0"
          :disabled="loading"
          :input-props="{ 'aria-label': '发布 ID（留空使用当前版本）', id: `${id}-release` }"
        />
      </NFormItem>
      <NFormItem label="列（逗号分隔，留空使用授权范围）" :label-props="{ for: `${id}-columns` }">
        <NInput
          v-model:value="draft.columns"
          :disabled="loading"
          :input-props="{ 'aria-label': '列（逗号分隔，留空使用授权范围）', id: `${id}-columns` }"
        />
      </NFormItem>
      <NFormItem label="每页行数" path="limit" :label-props="{ for: `${id}-limit` }">
        <NInputNumber
          v-model:value="draft.limit"
          :min="1"
          :max="1000"
          :precision="0"
          :disabled="loading"
          :input-props="{ 'aria-label': '每页行数', id: `${id}-limit` }"
        />
      </NFormItem>
      <NFormItem label="等值筛选" class="full-width" :label-props="{ for: `${id}-equals` }">
        <NInput
          v-model:value="draft.equals"
          type="textarea"
          :autosize="{ minRows: 5, maxRows: 14 }"
          :disabled="loading"
          :input-props="{ 'aria-label': '等值筛选', id: `${id}-equals` }"
        />
      </NFormItem>
    </div>
    <div class="form-actions">
      <NButton attr-type="submit" type="primary" :loading="loading">
        查询数据
      </NButton>
    </div>
  </NForm>
  <div v-if="result" class="section-gap">
    <div class="toolbar">
      <div class="query-meta">
        <span>Release {{ result.releaseId }}</span><span>授权版本 {{ result.policyRevision }}</span><span>{{ result.rows.length }} 行</span>
      </div>
      <NButton class="push" :disabled="loading" @click="download">
        <template #icon>
          <Download :size="16" />
        </template>导出当前页
      </NButton>
    </div>
    <DataGrid
      :rows="result.rows"
      :columns="columns"
      :paginated="false"
      :loading="loading"
    />
    <div class="pager">
      <NButton
        :disabled="loading || result.offset === 0"
        @click="run(() => page(Math.max(0, result!.offset - result!.limit)))"
      >
        <template #icon>
          <ChevronLeft :size="16" />
        </template>上一页
      </NButton>
      <NButton
        :disabled="
          loading || result.rows.length < result.limit || result.offset + result.limit > 100000
        "
        @click="run(() => page(result!.offset + result!.limit))"
      >
        下一页<template #icon>
          <ChevronRight :size="16" />
        </template>
      </NButton>
    </div>
  </div>
</template>

<style scoped src="./QueryPanel.css" />
