<script setup lang="ts">
import DataGrid from '../../../shared/components/DataGrid.vue'
import type { Action } from '../../../shared/types'
import type { Release } from '../types'
import { releaseColumns } from '../columns'
defineProps<{ rows: Release[], loading: boolean }>()
const emit = defineEmits<{ detail: [row: Release] }>()
function actions(row: Release): Action[] {
  return [{ label: '详情', run: () => emit('detail', row) }]
}
</script>
<template>
  <DataGrid
    :rows="rows"
    :columns="releaseColumns"
    :loading="loading"
    :actions="actions"
  />
</template>
