<script setup lang="ts">
const canWrite = useCan('write')
const canApproveEmpty = useCan('system')
const allowEmpty = ref(false)
const confirmEmpty = ref(false)
const requestKey = ref(crypto.randomUUID())
import { ref } from 'vue'
import { NButton, NCheckbox } from 'naive-ui'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useJobActions } from '../composables/use-jobs'
import { useCan } from '@/shared/security/permissions'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ datasetId: string; disabled?: boolean }>()
const emit = defineEmits<{ started: [id: string] }>()
const { run } = useJobActions(),
  { t } = useI18n()
async function start(approved = false) {
  if (allowEmpty.value && !approved) {
    confirmEmpty.value = true
    return
  }
  if (run.isPending.value || props.disabled || !canWrite.value) return
  try {
    const result = await run.mutateAsync({
      datasetId: props.datasetId,
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
    <NButton
      type="primary"
      size="small"
      :disabled="disabled || !canWrite"
      :loading="run.isPending.value"
      @click="start(false)"
      >{{ t('ui.run_trigger_0c3acd44') }}</NButton
    >
    <NCheckbox
      v-if="canApproveEmpty"
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
    @confirm="start(true)"
  />
</template>
<style scoped>
.run-trigger {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
