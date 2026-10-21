<script setup lang="ts">
import { NEmpty, NSpin, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Model } from '@/shared/api/types'
import { DataPreview } from '@/shared/ui/data-preview'
defineProps<{
  kind: 'definition' | 'processing'
  result?: Model<'Preview'>
  pending: boolean
  failed: boolean
}>()
const { t } = useI18n()
</script>
<template>
  <section class="preview-panel" :aria-label="t('datasets.editor.results.' + kind)">
    <header>
      <h2>{{ t('datasets.editor.results.' + kind) }}</h2>
      <NTag v-if="result" size="small" :bordered="false">{{
        t('datasets.resultCount', { rows: result.rows.length, fields: result.fields.length })
      }}</NTag>
      <span>{{ t('datasets.editor.resultHints.' + kind) }}</span>
    </header>
    <NSpin
      :show="pending"
      class="preview-body"
      :content-style="{ height: '100%', display: 'flex', flexDirection: 'column' }"
    >
      <DataPreview
        v-if="result"
        :rows="result.rows"
        :columns="result.fields.map((field) => field.target)"
        fill-height
      />
      <div v-else class="preview-empty">
        <NEmpty
          :description="
            failed ? t('datasets.editor.previewFailed') : t('datasets.editor.emptyResults.' + kind)
          "
        />
      </div>
    </NSpin>
  </section>
</template>
<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--surfaceRaised);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
h2 {
  font-size: 14px;
  margin: 0;
  white-space: nowrap;
}
header > span {
  color: var(--textSecondary);
  font-size: 12px;
}
.preview-body {
  flex: 1;
  min-height: 0;
}
.preview-empty {
  display: grid;
  place-items: center;
  height: 100%;
}
</style>
