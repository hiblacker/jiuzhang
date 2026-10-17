<script setup lang="ts">
import { h, nextTick, ref } from 'vue'
import { NButton, NDynamicTags, NInput, NTag, type InputInst } from 'naive-ui'
import { useI18n } from 'vue-i18n'
const model = defineModel<string[]>({ required: true })
const props = defineProps<{ disabled?: boolean }>()
const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const input = ref<InputInst | null>(null)
const pending = ref('')
async function focusAdd() {
  await nextTick()
  root.value?.querySelector<HTMLElement>('[data-add-tag]')?.focus()
}
async function remove(index: number) {
  if (props.disabled) return
  model.value = model.value.filter((_tag, position) => position !== index)
  await nextTick()
  const buttons = root.value?.querySelectorAll<HTMLElement>('[data-remove-tag]')
  if (buttons?.length) buttons[Math.min(index, buttons.length - 1)]?.focus()
  else await focusAdd()
}
function renderTag(tag: string, index: number) {
  return h(
    NTag,
    { title: tag, class: 'tag-editor__tag' },
    {
      default: () => [
        h('span', { class: 'tag-editor__label' }, tag),
        h(
          NButton,
          {
            size: 'tiny',
            quaternary: true,
            disabled: props.disabled,
            'data-remove-tag': '',
            'aria-label': t('tagEditor.remove', { tag }),
            onClick: () => remove(index),
          },
          () => t('delete'),
        ),
      ],
    },
  )
}
function confirm(submit: (value: string) => void, returnFocus = true) {
  if (props.disabled) return
  submit(pending.value)
  pending.value = ''
  if (returnFocus) void focusAdd()
}
function cancel(deactivate: () => void) {
  pending.value = ''
  deactivate()
  void focusAdd()
}
function keydown(event: KeyboardEvent, submit: (value: string) => void, deactivate: () => void) {
  if (event.isComposing) return
  if (event.key === 'Enter') {
    event.preventDefault()
    confirm(submit)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancel(deactivate)
  }
}
async function activate(open: () => void) {
  if (props.disabled) return
  pending.value = ''
  open()
  await nextTick()
  input.value?.focus()
}
</script>
<template>
  <div ref="root" role="group" :aria-label="t('tags')" class="tag-editor">
    <NDynamicTags v-model:value="model" :disabled="disabled" :render-tag="renderTag">
      <template #trigger="{ activate: open, disabled: unavailable }">
        <NButton data-add-tag dashed size="small" :disabled="unavailable" @click="activate(open)">
          {{ t('tagEditor.add') }}
        </NButton>
      </template>
      <template #input="{ submit, deactivate }">
        <NInput
          ref="input"
          v-model:value="pending"
          size="small"
          :disabled="disabled"
          :input-props="{ 'aria-label': t('tagEditor.input') }"
          @keydown="keydown($event, submit, deactivate)"
          @blur="confirm(submit, false)"
        />
      </template>
    </NDynamicTags>
  </div>
</template>
<style scoped>
.tag-editor {
  min-width: 0;
  width: 100%;
}
.tag-editor :deep(.tag-editor__tag .n-tag__content) {
  display: flex;
  min-width: 0;
  gap: 4px;
}
.tag-editor :deep(.tag-editor__label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-editor :deep(.tag-editor__tag) {
  max-width: 100%;
}
</style>
