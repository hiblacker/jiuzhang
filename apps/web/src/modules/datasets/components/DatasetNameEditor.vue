<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { NButton, NForm, NFormItem, NInput, type FormInst, type InputInst } from 'naive-ui'
import { Pencil } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const name = defineModel<string>({ required: true })
const props = defineProps<{ disabled: boolean; placeholder: string }>()
const { t } = useI18n()
const form = ref<FormInst>()
const input = ref<InputInst>()
const editButton = ref<InstanceType<typeof NButton>>()
const editing = ref(false)
const original = ref('')
const model = computed(() => ({ name: name.value }))
let confirming: Promise<boolean> | undefined

async function focus() {
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}
function open() {
  if (props.disabled) return
  original.value = name.value
  form.value?.restoreValidation()
  void focus()
}
async function validate() {
  editing.value = true
  await nextTick()
  try {
    await form.value?.validate()
    name.value = name.value.trim()
    editing.value = false
    return true
  } catch {
    editing.value = true
    return false
  }
}
function commit() {
  confirming ??= validate().finally(() => {
    confirming = undefined
  })
  return confirming
}
async function cancel() {
  name.value = original.value
  editing.value = false
  form.value?.restoreValidation()
  await nextTick()
  editButton.value?.$el.focus()
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || props.disabled) return
  if (event.key === 'Enter') {
    event.preventDefault()
    void commit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    void cancel()
  }
}
function blur() {
  if (editing.value) void commit()
}
defineExpose({ commit, focus })
</script>
<template>
  <NForm
    ref="form"
    class="dataset-name-editor"
    :class="{ 'is-editing': editing }"
    :model="model"
    :disabled="disabled"
    :rules="{
      name: {
        required: true,
        validator: (_rule, value: string) => !!value?.trim(),
        message: t('ui.dataset_editor_505e9598'),
        trigger: 'blur',
      },
    }"
    @submit.prevent
  >
    <NFormItem path="name" :show-label="false" :show-feedback="editing">
      <NInput
        v-if="editing"
        ref="input"
        v-model:value="name"
        :placeholder="t('ui.dataset_editor_5aa625bf')"
        :input-props="{ 'aria-label': t('ui.dataset_editor_5aa625bf') }"
        @keydown="keydown"
        @blur="blur"
      />
      <div v-else class="name-display">
        <h1>
          <NButton
            text
            class="name-title"
            :title="name || placeholder"
            :disabled="disabled"
            @click="open"
            >{{ name || placeholder }}</NButton
          >
        </h1>
        <NButton
          ref="editButton"
          quaternary
          circle
          size="small"
          :aria-label="t('datasets.editor.rename')"
          :disabled="disabled"
          @click="open"
          ><template #icon><Pencil :size="16" /></template
        ></NButton>
      </div>
    </NFormItem>
  </NForm>
</template>
<style scoped>
.dataset-name-editor {
  min-width: 0;
  max-width: min(420px, 40vw);
}
.is-editing {
  width: min(420px, 40vw);
}
.name-display {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
}
h1 {
  margin: 0;
  min-width: 0;
  overflow: hidden;
}
.name-title {
  max-width: 100%;
  font-size: 18px;
  font-weight: 600;
}
.name-title :deep(.n-button__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
