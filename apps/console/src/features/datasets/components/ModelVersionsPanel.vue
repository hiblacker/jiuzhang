<script setup lang="ts">
import DataGrid from '../../../shared/components/DataGrid.vue'
import type { Action } from '../../../shared/types'
import type { ModelVersion } from '../types'
import { versionColumns } from '../columns'
const props = defineProps<{ rows: ModelVersion[], loading: boolean, engineer: boolean }>()
const emit = defineEmits<{
  detail: [row: ModelVersion]
  register: [row: ModelVersion]
  impact: [version: number]
}>()
function actions(row: ModelVersion): Action[] {
  const items: Action[] = [{ label: '契约详情', run: () => emit('detail', row) }]
  if (props.engineer) {
    items.push(
      { label: '登记新版本', run: () => emit('register', row) },
      { label: '变更影响', run: () => emit('impact', row.version) },
    )
  }
  return items
}
</script>
<template>
  <DataGrid
    :rows="rows"
    :columns="versionColumns"
    :loading="loading"
    :actions="actions"
  />
</template>
