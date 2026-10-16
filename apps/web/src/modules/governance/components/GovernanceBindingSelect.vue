<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NSelect } from 'naive-ui'
import { useBindingOptions, useSelectedBindings } from '../composables/use-binding-options'
import { errorKey } from '@/shared/api/error-message'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import type { Model } from '@/shared/api/types'

const props = defineProps<{
  kind: 'quality' | 'masking'
  value: string[]
  label: string
  single?: boolean
  disabled?: boolean
  size?: 'small' | 'medium'
}>()
const emit = defineEmits<{ 'update:value': [value: string[]] }>()
const { t } = useI18n()
const search = ref('')
const query = useBindingOptions(() => props.kind, search)
const selected = useSelectedBindings(
  () => props.kind,
  () => props.value,
)
const listed = computed(
  () =>
    query.data.value?.pages.flatMap<Model<'Quality'> | Model<'Masking'>>((page) => page.data) ?? [],
)
const total = computed(() => query.data.value?.pages[0]?.meta.total)
const options = computed(() => {
  const entries = [...listed.value]
  for (const result of selected.value) {
    const item = result.data
    if (
      item &&
      (!search.value || item.name.toLowerCase().includes(search.value.toLowerCase())) &&
      !entries.some((entry) => entry.id === item.id)
    )
      entries.push(item)
  }
  return entries.map((item) => ({ value: item.id, label: item.name }))
})
const error = computed(() => query.error.value ?? selected.value.find((item) => item.error)?.error)
const fetching = computed(
  () => query.isFetching.value || selected.value.some((item) => item.isFetching),
)
function update(value: string | string[] | null) {
  if (value === null) emit('update:value', [])
  else emit('update:value', typeof value === 'string' ? [value] : value)
}
async function retry() {
  await Promise.all([query.refetch(), ...selected.value.map((item) => item.refetch())])
}
</script>
<template>
  <div class="governance-binding-select" role="group" :aria-label="label">
    <NSelect
      v-select-trigger-name="single ? t('governance.openBinding', { label }) : label"
      :value="single ? (value[0] ?? null) : value"
      :input-props="{ 'aria-label': single ? label : t('governance.searchBinding', { label }) }"
      :placeholder="label"
      :options="options"
      :loading="fetching"
      :disabled="disabled"
      :multiple="!single"
      :size="size"
      :fallback-option="false"
      filterable
      remote
      clearable
      @search="search = $event"
      @update:value="update"
    />
    <div v-if="query.data.value" class="binding-options-status">
      <span class="muted">{{
        total === undefined
          ? t('governance.bindingOptionsCount', { loaded: listed.length })
          : t('governance.bindingOptionsTotal', { loaded: listed.length, total })
      }}</span>
      <NButton
        v-if="query.hasNextPage.value"
        size="tiny"
        :loading="query.isFetchingNextPage.value"
        :disabled="disabled || query.isFetching.value"
        @click="query.fetchNextPage()"
        >{{ t('governance.loadMoreBindings') }}</NButton
      >
    </div>
    <NAlert v-if="error" type="error">
      <p>{{ t(errorKey(error)) }}</p>
      <NButton size="small" :disabled="disabled" @click="retry">{{ t('retry') }}</NButton>
    </NAlert>
  </div>
</template>
<style scoped>
.governance-binding-select {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 8px;
}
.binding-options-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
</style>
