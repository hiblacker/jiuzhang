<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { sql } from '@codemirror/lang-sql'
import { sqlEditorTheme, sqlHighlighting } from '@/shared/theme/sql-editor'
const props = defineProps<{ modelValue: string; label: string; readonly?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const el = ref<HTMLElement>()
let view: EditorView | undefined
const editable = new Compartment()
const theme = new Compartment()
let themeObserver: MutationObserver | undefined
onMounted(() => {
  let dark = document.documentElement.style.colorScheme === 'dark'
  view = new EditorView({
    parent: el.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        sql(),
        sqlHighlighting,
        theme.of(sqlEditorTheme(dark)),
        EditorView.contentAttributes.of(() => ({
          'aria-label': props.label,
          'aria-multiline': 'true',
        })),
        editable.of(EditorView.editable.of(!props.readonly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
  })
  themeObserver = new MutationObserver(() => {
    const nextDark = document.documentElement.style.colorScheme === 'dark'
    if (nextDark === dark) return
    dark = nextDark
    view?.dispatch({ effects: theme.reconfigure(sqlEditorTheme(dark)) })
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
})
watch(
  () => props.modelValue,
  (value) => {
    if (view && value !== view.state.doc.toString())
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  },
)
watch(
  () => props.readonly,
  (value) => view?.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!value)) }),
)
watch(
  () => props.label,
  () => view?.dispatch({}),
)
onBeforeUnmount(() => {
  themeObserver?.disconnect()
  view?.destroy()
})
</script>
<template><div ref="el" class="sql-editor" /></template>
<style scoped>
.sql-editor {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.sql-editor :deep(.cm-editor) {
  min-height: 220px;
  font-size: 13px;
}
.sql-editor :deep(.cm-scroller) {
  overflow: auto;
}
.sql-editor :deep(.cm-content) {
  font-family: monospace;
}
</style>
