<script setup lang="ts">
const canWrite = useCan('write')
const canApproveEmpty = useCan('system')
const allowEmpty = ref(false)
const confirmEmpty = ref(false)
const optionsOpen = ref(false)
const root = ref<HTMLElement>()
const allowEmptyCheckbox = ref<CheckboxInst>()
const requestKey = ref(crypto.randomUUID())
import { nextTick, ref, watch } from 'vue'
import { NButton, NCheckbox, NPopover, type CheckboxInst } from 'naive-ui'
import { SlidersHorizontal } from 'lucide-vue-next'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useJobActions } from '../composables/use-jobs'
import { useCan } from '@/shared/security/permissions'
import { useI18n } from 'vue-i18n'
const props = defineProps<{ datasetId: string; disabled?: boolean; compact?: boolean }>()
const emit = defineEmits<{ started: [id: string] }>()
const { run } = useJobActions(),
  { t } = useI18n()
watch(optionsOpen, async (open) => {
  if (!open) return
  await nextTick()
  allowEmptyCheckbox.value?.focus()
})
function closeOptions() {
  optionsOpen.value = false
  root.value?.querySelector<HTMLElement>('[data-run-options]')?.focus()
}
async function start(approved = false) {
  if (run.isPending.value || props.disabled || !canWrite.value) return
  if (allowEmpty.value && !approved) {
    confirmEmpty.value = true
    return
  }
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
  <div ref="root" class="run-trigger">
    <NButton
      type="primary"
      size="small"
      :disabled="disabled || !canWrite"
      :loading="run.isPending.value"
      @click="start(false)"
      >{{ t('ui.run_trigger_0c3acd44') }}</NButton
    >
    <NPopover
      v-if="canApproveEmpty && compact"
      v-model:show="optionsOpen"
      trigger="click"
      placement="bottom-end"
    >
      <template #trigger
        ><NButton
          data-run-options
          :quaternary="!allowEmpty"
          :secondary="allowEmpty"
          :type="allowEmpty ? 'warning' : 'default'"
          circle
          size="small"
          :aria-label="t('jobs.runOptions')"
          :aria-pressed="allowEmpty"
          :aria-expanded="optionsOpen"
          :disabled="disabled || !canWrite || run.isPending.value"
          @keydown.enter.prevent
          @keydown.space.prevent
          @keyup.enter.stop.prevent="optionsOpen = !optionsOpen"
          @keyup.space.stop.prevent="optionsOpen = !optionsOpen"
          @keydown.esc.stop.prevent="closeOptions"
          ><SlidersHorizontal :size="14" /></NButton
      ></template>
      <div
        class="run-options"
        role="group"
        :aria-label="t('jobs.runOptions')"
        @keydown.esc.stop.prevent="closeOptions"
      >
        <NCheckbox
          ref="allowEmptyCheckbox"
          v-model:checked="allowEmpty"
          :disabled="run.isPending.value"
          >{{ t('jobs.allowEmpty') }}</NCheckbox
        >
        <p>{{ t('jobs.allowEmptyWarning') }}</p>
      </div>
    </NPopover>
    <NCheckbox
      v-else-if="canApproveEmpty"
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
  flex-shrink: 0;
}
.run-options {
  max-width: 260px;
}
.run-options p {
  color: var(--textSecondary);
  font-size: 12px;
  line-height: 1.7;
  margin: 10px 0 0;
}
</style>
