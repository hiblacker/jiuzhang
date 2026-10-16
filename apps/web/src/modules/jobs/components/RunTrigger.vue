<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
import { ref } from 'vue'
import { NButton, NSelect, NAlert } from 'naive-ui'
import type { Model } from '@/shared/api/types'
import { useJobActions } from '../composables/use-jobs'
import { useCan } from '@/shared/security/permissions'
import { errorKey } from '@/shared/api/error-message'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ datasetId: string; disabled?: boolean }>()
const emit = defineEmits<{ started: [id: string] }>()
const outcome = ref<Model<'RunOutcome'>>('succeeded'),
  { run } = useJobActions(),
  { t } = useI18n()
async function start() {
  if (run.isPending.value) return
  try {
    const result = await run.mutateAsync({ datasetId: props.datasetId, outcome: outcome.value })
    emit('started', result.id)
  } catch {}
}
</script>
<template>
  <div class="run-trigger">
    <NSelect
      v-model:value="outcome"
      size="small"
      style="width: 130px"
      :options="[
        { label: uiText('ui.run_trigger_b791a1f7'), value: 'succeeded' },
        { label: uiText('ui.run_trigger_4857620b'), value: 'failed' },
        { label: uiText('ui.run_trigger_d6e418e3'), value: 'blocked' },
      ]"
    /><NButton
      type="primary"
      size="small"
      :disabled="disabled || !canWrite"
      :loading="run.isPending.value"
      @click="start"
      >{{ uiText('ui.run_trigger_0c3acd44') }}</NButton
    >
  </div>
  <NAlert v-if="run.error.value" type="error">{{ t(errorKey(run.error.value)) }}</NAlert>
</template>
<style scoped>
.run-trigger {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
