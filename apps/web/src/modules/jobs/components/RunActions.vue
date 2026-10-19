<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NSelect } from 'naive-ui'
import type { Model } from '@/shared/api/types'
import { useCan } from '@/shared/security/permissions'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useJobActions } from '../composables/use-jobs'
const props = defineProps<{ run: Model<'Run'>; size?: 'small' | 'medium' }>()
const emit = defineEmits<{ retried: [id: string] }>()
const { t } = useI18n()
const canWrite = useCan('write')
const real = import.meta.env.VITE_API_MODE === 'real'
const requestKey = ref(crypto.randomUUID())
const actions = useJobActions()
const outcome = ref<Model<'RunOutcome'>>('succeeded')
const cancelable = computed(() => ['queued', 'running', 'validating'].includes(props.run.status))
const retryable = computed(
  () => ['failed', 'blocked', 'canceled'].includes(props.run.status) && !props.run.retryRunId,
)
const pending = computed(() => actions.cancel.isPending.value || actions.retry.isPending.value)
async function cancel() {
  if (!canWrite.value || !cancelable.value || pending.value) return
  try {
    await actions.cancel.mutateAsync(props.run.id)
  } catch {}
}
async function retry() {
  if (!canWrite.value || !retryable.value || pending.value) return
  try {
    const run = await actions.retry.mutateAsync({
      id: props.run.id,
      outcome: outcome.value,
      key: requestKey.value,
    })
    requestKey.value = crypto.randomUUID()
    emit('retried', run.id)
  } catch {}
}
</script>
<template>
  <div class="run-actions">
    <NButton
      :size="size"
      :aria-label="t('jobs.cancelRun', { id: run.id })"
      :disabled="!canWrite || !cancelable || actions.retry.isPending.value"
      :loading="actions.cancel.isPending.value"
      @click="cancel"
      >{{ t('ui.run_detail_644b4a0b') }}</NButton
    >
    <NSelect
      v-if="retryable && !real"
      v-model:value="outcome"
      :size="size"
      v-select-trigger-name="t('jobs.retryOutcome', { id: run.id })"
      :disabled="!canWrite || pending"
      class="run-outcome"
      :options="[
        { label: t('ui.run_detail_b791a1f7'), value: 'succeeded' },
        { label: t('ui.run_detail_4857620b'), value: 'failed' },
        { label: t('ui.run_detail_d6e418e3'), value: 'blocked' },
      ]"
    />
    <NButton
      v-if="retryable"
      :size="size"
      type="primary"
      :aria-label="t('jobs.retryRun', { id: run.id })"
      :disabled="!canWrite || actions.cancel.isPending.value"
      :loading="actions.retry.isPending.value"
      @click="retry"
      >{{ t('ui.run_detail_9addab5c') }}</NButton
    >
  </div>
</template>
<style scoped>
.run-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.run-outcome {
  width: 130px;
}
</style>
