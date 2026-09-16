<script setup lang="ts">
import { NButton } from 'naive-ui'
import DataGrid from '../../../shared/components/DataGrid.vue'
import type { Action } from '../../../shared/types'
import type { Build } from '../types'
import { buildColumns } from '../columns'
const props = defineProps<{ rows: Build[], loading: boolean, canBuild: boolean, owner: boolean }>()
const emit = defineEmits<{
  detail: [row: Build]
  publish: [id: number]
  cancel: [id: number]
  create: []
}>()
function actions(row: Build): Action[] {
  const items: Action[] = [{ label: '质量与依赖', run: () => emit('detail', row) }]
  if (props.owner && row.state === 'READY') {
    items.push({ label: '发布', run: () => emit('publish', row.id) })
  }
  if (['QUEUED', 'RUNNING'].includes(row.state)) {
    items.push({ label: '取消', danger: true, run: () => emit('cancel', row.id) })
  }
  return items
}
</script>
<template>
  <div class="toolbar">
    <NButton type="primary" :disabled="loading || !canBuild" @click="$emit('create')">
      构建候选
    </NButton>
  </div>
  <DataGrid
    :rows="rows"
    :columns="buildColumns"
    :loading="loading"
    :actions="actions"
  />
</template>
