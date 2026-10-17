<script setup lang="ts">
import { computed } from 'vue'
import { NSelect, NAlert, NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useFolders } from '../composables/use-folders'
import { folderOptions } from '../model/folders'

const props = defineProps<{
  modelValue?: string | null
  label: string
  emptyLabel: string
  excludeId?: string
  disabled?: boolean
}>()
defineEmits<{ 'update:modelValue': [value: string | null] }>()
const { t } = useI18n()
const query = useFolders()
const options = computed(() => folderOptions(query.data.value ?? [], props.excludeId))
</script>
<template>
  <div class="folder-select">
    <NSelect
      v-select-trigger-name="t('openSelect', { label })"
      :value="modelValue ?? null"
      :options="options"
      :loading="query.isLoading.value"
      :disabled="disabled || query.isError.value"
      :input-props="{ 'aria-label': label }"
      :placeholder="emptyLabel"
      clearable
      filterable
      @update:value="$emit('update:modelValue', $event)"
    />
    <NAlert v-if="query.error.value" type="error" :title="t('folders.loadError')">
      <NButton size="small" @click="query.refetch()">{{ t('retry') }}</NButton>
    </NAlert>
  </div>
</template>
<style scoped>
.folder-select {
  width: 100%;
  display: grid;
  gap: 8px;
}
</style>
