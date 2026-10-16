<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NSelect } from 'naive-ui'
import { useDependencyTaskOptions, useSelectedTasks } from '../composables/use-jobs'
import { errorKey } from '@/shared/api/error-message'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'

const props = withDefaults(
  defineProps<{
    value: string[]
    excludedTaskId?: string
    excludedDatasetId?: string
    disabled?: boolean
  }>(),
  { excludedTaskId: '', excludedDatasetId: '' },
)
const emit = defineEmits<{ 'update:value': [value: string[]] }>()
const { t } = useI18n()
const search = ref('')
const query = useDependencyTaskOptions(
  search,
  () => props.excludedTaskId,
  () => props.excludedDatasetId,
)
const selected = useSelectedTasks(() => props.value)
const listed = computed(() => query.data.value?.pages.flatMap((page) => page.data) ?? [])
const total = computed(() => query.data.value?.pages[0]?.meta.total)
const options = computed(() => {
  const entries = [...listed.value]
  for (const result of selected.value) {
    const task = result.data
    if (task && !entries.some((item) => item.id === task.id)) entries.push(task)
  }
  return entries.map((task) => ({
    value: task.id,
    label: task.name,
    disabled: task.id === props.excludedTaskId || task.datasetId === props.excludedDatasetId,
  }))
})
const error = computed(() => query.error.value ?? selected.value.find((item) => item.error)?.error)
const fetching = computed(
  () => query.isFetching.value || selected.value.some((item) => item.isFetching),
)
async function retry() {
  await Promise.all([query.refetch(), ...selected.value.map((item) => item.refetch())])
}
</script>
<template>
  <div class="task-dependency-select" role="group" :aria-label="t('jobs.dependencyPicker')">
    <NSelect
      v-select-trigger-name="t('jobs.dependencyTrigger')"
      :value="value"
      :input-props="{ 'aria-label': t('ui.schedule_form_8a88d05f') }"
      :placeholder="t('ui.schedule_form_8a88d05f')"
      :options="options"
      :loading="fetching"
      :disabled="disabled"
      :fallback-option="false"
      filterable
      remote
      multiple
      clearable
      @search="search = $event"
      @update:value="emit('update:value', $event)"
    />
    <div v-if="query.data.value" class="dependency-options-status">
      <span class="muted">{{
        total === undefined
          ? t('jobs.dependencyOptionsCount', { loaded: listed.length })
          : t('jobs.dependencyOptionsTotal', { loaded: listed.length, total })
      }}</span>
      <NButton
        v-if="query.hasNextPage.value"
        size="small"
        :loading="query.isFetchingNextPage.value"
        :disabled="disabled || query.isFetching.value"
        @click="query.fetchNextPage()"
        >{{ t('jobs.loadMoreDependencies') }}</NButton
      >
    </div>
    <NAlert v-if="error" type="error">
      <p>{{ t(errorKey(error)) }}</p>
      <NButton size="small" :disabled="disabled" @click="retry">{{ t('retry') }}</NButton>
    </NAlert>
  </div>
</template>
<style scoped>
.task-dependency-select {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 8px;
}
.dependency-options-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
}
</style>
