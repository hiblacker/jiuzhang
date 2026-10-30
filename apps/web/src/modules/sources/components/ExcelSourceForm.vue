<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import {
  NAlert,
  NButton,
  NFormItem,
  NInputNumber,
  NSelect,
  NUpload,
  type UploadFileInfo,
} from 'naive-ui'
import { sourceRepository, type SourceInput } from '../api/source-repository'
import { DataPreview } from '@/shared/ui/data-preview'
import { useCan } from '@/shared/security/permissions'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'

const draft = defineModel<SourceInput>({ required: true })
const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const { t } = useI18n()
const canPreview = useCan('readSensitive')
const sheets = ref<string[]>([])
const fileInfo = useQuery({
  queryKey: computed(() => ['sources', 'excel-file', draft.value.settings.fileId]),
  queryFn: () => sourceRepository.fileInfo(draft.value.settings.fileId ?? ''),
  enabled: computed(() => !!draft.value.settings.fileId),
})
const upload = useMutation({
  mutationFn: sourceRepository.upload,
  onSuccess(file) {
    sheets.value = file.sheets
    draft.value.settings = {
      fileId: file.id,
      fileName: file.fileName,
      sheet: file.sheets[0] ?? '',
      headerRow: 1,
    }
    preview.reset()
  },
})
const preview = useMutation({
  mutationFn: () =>
    sourceRepository.previewFile(
      draft.value.settings.fileId ?? '',
      draft.value.settings.sheet ?? '',
      draft.value.settings.headerRow ?? 1,
    ),
})
const busy = computed(() => upload.isPending.value || preview.isPending.value)
// The parent owns navigation/save guards while these file requests are active.
watch(busy, (value) => emit('busy', value), { immediate: true })
// A changed worksheet/header invalidates the previously displayed file sample.
watch(
  () => [draft.value.settings.fileId, draft.value.settings.sheet, draft.value.settings.headerRow],
  () => preview.reset(),
  { flush: 'sync' },
)
const options = computed(() =>
  [...new Set([...(fileInfo.data.value?.sheets ?? sheets.value), draft.value.settings.sheet ?? ''])]
    .filter(Boolean)
    .map((name) => ({ label: name, value: name })),
)
async function choose({ file }: { file: UploadFileInfo }) {
  if (!file.file || busy.value || props.disabled) return false
  try {
    await upload.mutateAsync(file.file)
  } catch {}
  return false
}
async function showPreview() {
  if (!busy.value) {
    try {
      await preview.mutateAsync()
    } catch {}
  }
}
</script>
<template>
  <section :aria-label="t('sources.excelFile')">
    <NAlert type="info" class="excel-note">{{ t('sources.excelHint') }}</NAlert>
    <NFormItem :label="t('sources.excelFile')" path="settings.fileId">
      <div class="excel-upload">
        <NUpload
          class="excel-upload-control"
          accept=".xls,.xlsx"
          :show-file-list="false"
          :disabled="disabled || busy"
          @before-upload="choose"
        >
          <NButton :disabled="disabled || busy" :loading="upload.isPending.value">{{
            t('sources.excelUpload')
          }}</NButton>
        </NUpload>
        <span v-if="draft.settings.fileName" class="excel-name">{{ draft.settings.fileName }}</span>
      </div>
    </NFormItem>
    <NFormItem :label="t('sources.excelSheet')" path="settings.sheet">
      <NSelect
        v-select-trigger-name="t('sources.excelSheet')"
        v-model:value="draft.settings.sheet"
        :input-props="{ 'aria-label': t('sources.excelSheet') }"
        :options="options"
        :disabled="disabled || busy || !draft.settings.fileId"
      />
    </NFormItem>
    <NFormItem :label="t('sources.excelHeaderRow')" path="settings.headerRow">
      <NInputNumber
        v-model:value="draft.settings.headerRow"
        :min="1"
        :max="1000"
        :precision="0"
        :input-props="{ 'aria-label': t('sources.excelHeaderRow') }"
        :disabled="disabled || busy"
      />
    </NFormItem>
    <NButton
      v-if="canPreview"
      :disabled="disabled || busy || !draft.settings.fileId"
      :loading="preview.isPending.value"
      @click="showPreview"
      >{{ t('sources.excelPreview') }}</NButton
    >
    <DataPreview
      v-if="preview.data.value"
      :columns="preview.data.value.fields.map((field) => ({ key: field.name, title: field.name }))"
      :rows="preview.data.value.rows"
    />
  </section>
</template>
<style scoped>
.excel-note {
  margin-bottom: 20px;
}
.excel-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.excel-upload {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
.excel-upload-control {
  width: auto;
  flex-shrink: 0;
}
</style>
