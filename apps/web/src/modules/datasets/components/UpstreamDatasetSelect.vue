<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { NAlert, NButton, NSelect } from 'naive-ui'
import { useDataset, useUpstreamDatasetOptions } from '../composables/use-datasets'
import { errorKey } from '@/shared/api/error-message'

const props = defineProps<{ value: string; excludedId: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:value': [value: string | null] }>()
const { t } = useI18n()
const search = ref('')
const query = useUpstreamDatasetOptions(search, () => props.excludedId)
const selected = useDataset(() => props.value)
const listed = computed(() => query.data.value?.pages.flatMap((page) => page.data) ?? [])
const total = computed(() => query.data.value?.pages[0]?.meta.total)
const options = computed(() => {
  const entries = [...listed.value]
  const current = selected.data.value
  if (current && current.id === props.value && !entries.some((item) => item.id === current.id))
    entries.unshift(current)
  return entries.map((dataset) => ({
    value: dataset.id,
    label: dataset.name + ' · v' + dataset.publishedVersion,
    disabled: dataset.id === props.excludedId || dataset.publishedVersion === 0,
  }))
})
const error = computed(() => query.error.value ?? selected.error.value)
async function retry() {
  await Promise.all([query.refetch(), ...(props.value ? [selected.refetch()] : [])])
}
</script>
<template>
  <div class="upstream-dataset-select" role="group" :aria-label="t('datasets.upstreamPicker')">
    <NSelect
      v-select-trigger-name="t('openSelect', { label: t('datasets.upstream') })"
      :value="value || null"
      :input-props="{ 'aria-label': t('datasets.upstream') }"
      :placeholder="t('datasets.selectUpstream')"
      :options="options"
      :loading="query.isFetching.value || (!!value && selected.isFetching.value)"
      :disabled="disabled"
      :fallback-option="false"
      filterable
      remote
      clearable
      @search="search = $event"
      @update:value="emit('update:value', $event)"
    />
    <div v-if="query.data.value" class="upstream-options-status">
      <span class="muted">{{
        total === undefined
          ? t('datasets.upstreamOptionsCount', { loaded: listed.length })
          : t('datasets.upstreamOptionsTotal', { loaded: listed.length, total })
      }}</span>
      <NButton
        v-if="query.hasNextPage.value"
        size="small"
        :loading="query.isFetchingNextPage.value"
        :disabled="disabled || query.isFetching.value"
        @click="query.fetchNextPage()"
        >{{ t('datasets.loadMoreUpstream') }}</NButton
      >
    </div>
    <NAlert v-if="error" type="error">
      <p>{{ t(errorKey(error)) }}</p>
      <NButton size="small" :disabled="disabled" @click="retry">{{ t('retry') }}</NButton>
    </NAlert>
  </div>
</template>
<style scoped>
.upstream-dataset-select {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 8px;
}
.upstream-options-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
}
</style>
