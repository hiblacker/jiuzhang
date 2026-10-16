<script setup lang="ts">
import { ref, watch } from 'vue'
import { NModal, NButton, NSpace, NAlert, NFormItem } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Model } from '@/shared/api/types'
import { errorKey } from '@/shared/api/error-message'
import { useCan } from '@/shared/security/permissions'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { useFolderActions } from '../composables/use-folders'
import DatasetFolderSelect from './DatasetFolderSelect.vue'
const props = defineProps<{ dataset: Model<'Dataset'> | null }>()
const emit = defineEmits<{ close: []; moved: [] }>()
const { t } = useI18n(),
  actions = useFolderActions(),
  canWrite = useCan('write')
const folderId = ref<string | null>(null),
  initialFolder = ref<string | null>(null)
watch(
  () => props.dataset?.id,
  () => {
    folderId.value = props.dataset?.folderId ?? null
    initialFolder.value = folderId.value
    actions.move.reset()
  },
  { immediate: true },
)
const { canLeave } = useEditGuard(
  () => !!props.dataset && folderId.value !== initialFolder.value,
  actions.move.isPending,
)
function close() {
  if (canLeave()) emit('close')
}
async function save() {
  if (!props.dataset || actions.move.isPending.value || !canWrite.value) return
  try {
    await actions.move.mutateAsync({ id: props.dataset.id, folderId: folderId.value })
    initialFolder.value = folderId.value
    emit('moved')
  } catch {
    /* Preserve selection for retry. */
  }
}
</script>
<template>
  <NModal
    :show="!!dataset"
    preset="card"
    :title="t('folders.move')"
    style="width: min(500px, calc(100vw - 32px))"
    :closable="!actions.move.isPending.value"
    :mask-closable="!actions.move.isPending.value"
    :close-on-esc="!actions.move.isPending.value"
    @close="close"
    @update:show="!$event && close()"
  >
    <p>{{ dataset?.name }}</p>
    <NFormItem :label="t('folders.target')"
      ><DatasetFolderSelect
        v-model="folderId"
        :label="t('folders.target')"
        :empty-label="t('folders.unfiled')"
        :disabled="actions.move.isPending.value"
    /></NFormItem>
    <NAlert v-if="actions.move.error.value" type="error">{{
      t(errorKey(actions.move.error.value))
    }}</NAlert>
    <template #footer
      ><NSpace justify="end"
        ><NButton :disabled="actions.move.isPending.value" @click="close">{{ t('cancel') }}</NButton
        ><NButton
          type="primary"
          :loading="actions.move.isPending.value"
          :disabled="!canWrite || folderId === initialFolder"
          @click="save"
          >{{ t('folders.confirmMove') }}</NButton
        ></NSpace
      ></template
    >
  </NModal>
</template>
