<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { NSelect, NButton, NAlert } from 'naive-ui'
import { useTable, useTableOptions } from '../composables/use-warehouse'
import { errorKey } from '@/shared/api/error-message'

const props = defineProps<{
  value: string
  label: string
  disabled?: boolean
  selectFirst?: boolean
}>()
const emit = defineEmits<{ 'update:value': [value: string] }>()
const { t } = useI18n()
const search = ref('')
const query = useTableOptions(search)
const selected = useTable(() => props.value)
const listed = computed(() => query.data.value?.pages.flatMap((page) => page.data) ?? [])
const total = computed(() => query.data.value?.pages[0]?.meta.total)
const options = computed(() => {
  const entries = [...listed.value]
  const current = selected.data.value
  if (current && current.id === props.value && !entries.some((table) => table.id === current.id))
    entries.unshift(current)
  return entries.map((table) => ({ value: table.id, label: table.name }))
})
const error = computed(() => query.error.value ?? selected.error.value)
watch(
  [() => props.value, listed],
  ([value, tables]) => {
    if (!value && props.selectFirst && !search.value && tables[0])
      emit('update:value', tables[0].id)
  },
  { immediate: true },
)
async function retry() {
  await Promise.all([query.refetch(), ...(props.value ? [selected.refetch()] : [])])
}
</script>
<template>
  <div class="warehouse-table-select">
    <NSelect
      v-select-trigger-name="t('openSelect', { label })"
      :value="value || null"
      :input-props="{ 'aria-label': label }"
      :placeholder="label"
      :options="options"
      :loading="query.isFetching.value || (!!value && selected.isFetching.value)"
      :disabled="disabled"
      :fallback-option="false"
      filterable
      remote
      @search="search = $event"
      @update:value="emit('update:value', $event)"
    />
    <div v-if="query.data.value" class="table-options-status">
      <span class="muted">{{
        total === undefined
          ? t('warehouse.tableOptionsCount', { loaded: listed.length })
          : t('warehouse.tableOptionsTotal', { loaded: listed.length, total })
      }}</span>
      <NButton
        v-if="query.hasNextPage.value"
        size="small"
        :loading="query.isFetchingNextPage.value"
        :disabled="disabled || query.isFetching.value"
        @click="query.fetchNextPage()"
        >{{ t('warehouse.loadMoreTables') }}</NButton
      >
    </div>
    <NAlert v-if="error" type="error">
      <p>{{ t(errorKey(error)) }}</p>
      <NButton size="small" :disabled="disabled" @click="retry">{{ t('retry') }}</NButton>
    </NAlert>
  </div>
</template>
<style scoped>
.warehouse-table-select {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 8px;
}
.table-options-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
}
</style>
