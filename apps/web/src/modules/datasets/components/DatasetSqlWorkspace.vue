<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { NButton, NSplit } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Model } from '@/shared/api/types'
import type { SQLNamespace } from '@codemirror/lang-sql'
import DatasetPreviewPanel from './DatasetPreviewPanel.vue'
const SqlEditor = defineAsyncComponent(() => import('@/shared/editors/SqlEditor.vue'))
defineProps<{
  modelValue: string
  result?: Model<'Preview'>
  pending: boolean
  failed: boolean
  disabled: boolean
  schema?: SQLNamespace
  database?: string
}>()
defineEmits<{ 'update:modelValue': [value: string]; run: [] }>()
const { t } = useI18n()
const editorSize = ref(0.42)
const editor = ref<InstanceType<typeof SqlEditor>>()
defineExpose({ insertText: (text: string) => editor.value?.insertText(text) })
function resize(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') editorSize.value = Math.max(0.25, editorSize.value - 0.05)
  else if (event.key === 'ArrowDown') editorSize.value = Math.min(0.65, editorSize.value + 0.05)
  else if (event.key === 'Home') editorSize.value = 0.25
  else if (event.key === 'End') editorSize.value = 0.65
  else return
  event.preventDefault()
}
</script>
<template>
  <section class="sql-workspace" :aria-label="t('datasets.sqlWorkspace')">
    <div class="sql-toolbar">
      <strong>{{ t('datasets.sqlMode') }}</strong>
      <span>{{ t('datasets.sqlRunHint') }}</span>
      <NButton type="primary" :disabled="disabled" :loading="pending" @click="$emit('run')">
        {{ t('datasets.runSql') }}
      </NButton>
    </div>
    <div class="sql-body">
      <NSplit
        v-model:size="editorSize"
        direction="vertical"
        :min="0.25"
        :max="0.65"
        :resize-trigger-size="12"
        class="sql-split"
      >
        <template #1>
          <SqlEditor
            ref="editor"
            :model-value="modelValue"
            :label="t('datasets.sqlEditor')"
            :readonly="pending"
            mysql
            run-shortcut
            :schema="schema"
            :default-schema="database"
            @update:model-value="$emit('update:modelValue', $event)"
            @run="!disabled && $emit('run')"
          />
        </template>
        <template #resize-trigger>
          <div
            class="sql-resizer"
            role="separator"
            tabindex="0"
            aria-orientation="horizontal"
            :aria-label="t('datasets.resizeSql')"
            :aria-valuenow="Math.round(editorSize * 100)"
            :aria-valuemin="25"
            :aria-valuemax="65"
            @keydown="resize"
          >
            <span />
          </div>
        </template>
        <template #2>
          <DatasetPreviewPanel
            kind="definition"
            :result="result"
            :pending="pending"
            :failed="failed"
          />
        </template>
      </NSplit>
    </div>
    <p class="sql-help">
      {{ t('datasets.sqlHelp') }}
    </p>
  </section>
</template>
<style scoped>
.sql-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.sql-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-bottom: none;
  background: var(--surfaceRaised);
}
.sql-toolbar > span {
  flex: 1;
}
.sql-toolbar > span,
.sql-help {
  color: var(--textSecondary);
  font-size: 12px;
}
.sql-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.sql-split {
  height: 100%;
}
.sql-split :deep(.sql-editor),
.sql-split :deep(.cm-editor) {
  height: 100%;
  min-height: 0;
}
.sql-split :deep(.sql-editor) {
  border-radius: 0;
}
.sql-resizer {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
}
.sql-resizer span {
  width: 40px;
  height: 3px;
  border-radius: 3px;
  background: var(--border);
}
.sql-resizer:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.sql-help {
  margin: 10px 0 0;
  line-height: 1.6;
}
</style>
