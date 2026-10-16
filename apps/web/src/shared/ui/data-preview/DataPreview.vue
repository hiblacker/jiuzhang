<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { NButton, NDataTable, NModal, NSpace, type DataTableColumns } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { CopyButton } from '@/shared/ui/copy-button'
import type { Model } from '@/shared/api/types'
type Row = Model<'Row'>
const props = defineProps<{ columns: string[]; rows: Row[] }>()
const { t } = useI18n()
const page = ref(1)
const pageSize = ref(50)
const selected = ref<{ column: string; value: string } | null>(null)
watch([() => props.rows, () => JSON.stringify(props.columns)], () => {
  page.value = 1
  selected.value = null
})
const columns = computed<DataTableColumns<Row>>(() =>
  props.columns.map((column) => ({
    title: column,
    key: column,
    width: 180,
    ellipsis: { tooltip: true },
    render: (row, index) => {
      let value = '—'
      if (Object.hasOwn(row, column)) value = row[column] === null ? 'NULL' : String(row[column])
      if (value.length <= 80 && !value.includes('\n')) return value
      return h(
        NButton,
        {
          text: true,
          type: 'primary',
          class: 'preview-value',
          'aria-label': t('dataPreview.inspect', { column, row: index + 1 }),
          onClick: () => {
            selected.value = { column, value }
          },
        },
        () => h('span', { class: 'preview-value__text' }, value),
      )
    },
  })),
)
</script>
<template>
  <section :aria-label="t('dataPreview.region')" class="data-preview">
    <NDataTable
      :columns="columns"
      :data="rows"
      :bordered="false"
      :max-height="480"
      table-layout="fixed"
      :scroll-x="Math.max(180, columns.length * 180)"
      :pagination="
        rows.length > 50
          ? {
              page,
              pageSize,
              showSizePicker: true,
              pageSizes: [20, 50, 100],
              onUpdatePage: (value: number) => (page = value),
              onUpdatePageSize: (value: number) => {
                pageSize = value
                page = 1
              },
            }
          : false
      "
    />
    <NModal
      :show="selected !== null"
      preset="card"
      :title="t('dataPreview.valueTitle', { column: selected?.column ?? '' })"
      :aria-label="t('dataPreview.valueTitle', { column: selected?.column ?? '' })"
      style="width: min(720px, calc(100vw - 32px))"
      @update:show="!$event && (selected = null)"
      @close="selected = null"
    >
      <pre class="full-value">{{ selected?.value }}</pre>
      <template #footer>
        <NSpace justify="end">
          <CopyButton :value="selected?.value ?? ''" />
          <NButton autofocus @click="selected = null">{{ t('close') }}</NButton>
        </NSpace>
      </template>
    </NModal>
  </section>
</template>
<style scoped>
.data-preview {
  min-width: 0;
}
.data-preview :deep(.preview-value) {
  max-width: 100%;
  justify-content: flex-start;
}
.data-preview :deep(.preview-value .n-button__content) {
  overflow: hidden;
}
.data-preview :deep(.preview-value__text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.full-value {
  max-height: 50vh;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  padding: 16px;
  background: var(--surface);
  border-radius: 8px;
}
</style>
