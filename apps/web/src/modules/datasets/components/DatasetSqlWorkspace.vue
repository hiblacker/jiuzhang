<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { NAlert, NButton, NEmpty, NSplit, NSpin, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Model } from '@/shared/api/types'
import { DataPreview } from '@/shared/ui/data-preview'
const SqlEditor = defineAsyncComponent(() => import('@/shared/editors/SqlEditor.vue'))
defineProps<{
  modelValue: string
  result?: Model<'Preview'>
  pending: boolean
  failed: boolean
  disabled: boolean
  schemaCurrent: boolean
  schemaChanges?: { added: string[]; removed: string[] }
}>()
defineEmits<{ 'update:modelValue': [value: string]; run: [] }>()
const { t } = useI18n()
const editorSize = ref(0.42)
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
      <span>{{ t('datasets.sqlRunHint') }}</span>
      <NButton type="primary" :disabled="disabled" :loading="pending" @click="$emit('run')">
        {{ t('datasets.runSql') }}
      </NButton>
    </div>
    <div class="sql-body">
      <aside class="sql-reference" :aria-label="t('datasets.sourceReference')">
        <slot name="reference" />
      </aside>
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
            :model-value="modelValue"
            :label="t('datasets.sqlEditor')"
            :readonly="pending"
            @update:model-value="$emit('update:modelValue', $event)"
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
          <section class="sql-result" :aria-label="t('datasets.sqlResult')">
            <header>
              <h2>{{ t('datasets.sqlResult') }}</h2>
              <NTag v-if="result" size="small" :bordered="false">{{
                t('datasets.resultCount', {
                  rows: result.rows.length,
                  fields: result.fields.length,
                })
              }}</NTag>
              <span v-if="result">{{ t('datasets.sqlResultLimit') }}</span>
            </header>
            <NAlert v-if="schemaChanges?.removed.length" type="warning" :show-icon="false">
              {{ t('datasets.schemaRemoved', { fields: schemaChanges.removed.join('、') }) }}
            </NAlert>
            <NSpin
              :show="pending"
              class="result-body"
              :content-style="{ height: '100%', display: 'flex', flexDirection: 'column' }"
            >
              <DataPreview
                v-if="result"
                :rows="result.rows"
                :columns="result.fields.map((field) => field.target)"
                fill-height
              />
              <div v-else class="result-empty">
                <NEmpty
                  :description="
                    pending
                      ? t('datasets.sqlRunning')
                      : failed
                        ? t('datasets.sqlFailed')
                        : t('datasets.sqlResultEmpty')
                  "
                />
              </div>
            </NSpin>
          </section>
        </template>
      </NSplit>
    </div>
    <p class="sql-help">
      {{ t('datasets.sqlHelp') }}
      {{ schemaCurrent ? t('datasets.sqlFieldsHelp') : t('datasets.sqlNeedsRun') }}
    </p>
  </section>
</template>
<style scoped>
.sql-workspace {
  min-width: 0;
}
.sql-toolbar,
.sql-result header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sql-toolbar {
  justify-content: space-between;
  margin-bottom: 10px;
}
.sql-toolbar > span,
.sql-help,
.sql-result header > span {
  color: var(--textSecondary);
  font-size: 12px;
}
.sql-body {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 16px;
  height: clamp(400px, calc(100vh - 520px), 900px);
}
.sql-reference {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.sql-split {
  height: 100%;
}
.sql-split :deep(.sql-editor),
.sql-split :deep(.cm-editor) {
  height: 100%;
  min-height: 0;
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
.sql-result {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.sql-result header {
  padding: 10px 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}
.sql-result h2 {
  font-size: 14px;
  margin: 0;
}
.result-body {
  flex: 1;
  min-height: 0;
}
.result-empty {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 100px;
}
.sql-help {
  margin: 10px 0 0;
  line-height: 1.6;
}
</style>
