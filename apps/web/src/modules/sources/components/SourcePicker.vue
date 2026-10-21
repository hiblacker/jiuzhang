<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { NButton, NSelect } from 'naive-ui'
import { useSource, useSourceOptions } from '../composables/use-sources'

const props = defineProps<{ value: string; label: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:value': [value: string] }>()
const { t } = useI18n()
const search = ref('')
const query = useSourceOptions(search)
const selected = useSource(() => props.value)
const listed = computed(() => query.data.value?.data ?? [])
const options = computed(() => {
  const entries = [...listed.value]
  const current = selected.data.value
  if (
    !search.value.trim() &&
    current &&
    current.id === props.value &&
    !entries.some((source) => source.id === current.id)
  )
    entries.unshift(current)
  // A selected source outside the first page still needs its name, within the same 20 options.
  return entries.slice(0, 20).map((source) => ({ value: source.id, label: source.name }))
})
const error = computed(() => query.error.value ?? selected.error.value)
async function retry() {
  await Promise.all([query.refetch(), ...(props.value ? [selected.refetch()] : [])])
}
</script>
<template>
  <div class="source-picker" role="group" :aria-label="t('sources.picker')">
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
      @update:show="!$event && (search = '')"
      @update:value="emit('update:value', $event)"
    />
    <NButton v-if="error" size="small" :disabled="disabled" @click="retry">{{
      t('retry')
    }}</NButton>
  </div>
</template>
<style scoped>
.source-picker {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 8px;
}
</style>
