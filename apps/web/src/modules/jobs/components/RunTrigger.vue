<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
const canApproveEmpty = useCan('system')
const real = import.meta.env.VITE_API_MODE === 'real'
const allowEmpty = ref(false)
const confirmEmpty = ref(false)
const requestKey = ref(crypto.randomUUID())
import { ref } from 'vue'
import { NButton, NSelect, NAlert, NCheckbox } from 'naive-ui'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import type { Model } from '@/shared/api/types'
import { useJobActions } from '../composables/use-jobs'
import { useCan } from '@/shared/security/permissions'
import { errorKey } from '@/shared/api/error-message'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ datasetId: string; disabled?: boolean }>()
const emit = defineEmits<{ started: [id: string] }>()
const outcome = ref<Model<'RunOutcome'>>('succeeded'),
  { run } = useJobActions(),
  { t } = useI18n()
async function start(approved = false) {
  if (real && allowEmpty.value && !approved) {
    confirmEmpty.value = true
    return
  }
  if (run.isPending.value || props.disabled || !canWrite.value) return
  try {
    const result = await run.mutateAsync({
      datasetId: props.datasetId,
      outcome: outcome.value,
      allowEmptySnapshot: allowEmpty.value,
      key: requestKey.value,
    })
    requestKey.value = crypto.randomUUID()
    confirmEmpty.value = false
    allowEmpty.value = false
    emit('started', result.id)
  } catch {}
}
</script>
<template>
  <div class="run-trigger">
    <NSelect
      v-if="!real"
      v-model:value="outcome"
      v-select-trigger-name="t('jobs.runOutcome', { id: datasetId })"
      :disabled="disabled || !canWrite || run.isPending.value"
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
      @click="start(false)"
      >{{ uiText('ui.run_trigger_0c3acd44') }}</NButton
    >
    <NCheckbox
      v-if="real && canApproveEmpty"
      v-model:checked="allowEmpty"
      :disabled="run.isPending.value"
      >{{ t('jobs.allowEmpty') }}</NCheckbox
    >
  </div>
  <ConfirmDialog
    :show="confirmEmpty"
    :confirm-text="t('confirm')"
    :destructive="false"
    @cancel="confirmEmpty = false"
    :title="t('jobs.allowEmpty')"
    :description="t('jobs.allowEmptyWarning')"
    :pending="run.isPending.value"
    :error="run.error.value ? t(errorKey(run.error.value)) : undefined"
    @confirm="start(true)"
  />
  <NAlert v-if="run.error.value" type="error">{{ t(errorKey(run.error.value)) }}</NAlert>
</template>
<style scoped>
.run-trigger {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
