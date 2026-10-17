<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NCard,
  NButton,
  NSpace,
  NTree,
  NModal,
  NForm,
  NFormItem,
  NInput,
  NAlert,
  type FormInst,
  type TreeOption,
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useFolders, useFolderActions } from '../composables/use-folders'
import DatasetFolderSelect from './DatasetFolderSelect.vue'
import { AsyncState } from '@/shared/ui/async-state'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useCan } from '@/shared/security/permissions'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { ApiError } from '@/shared/api/client'
import { errorKey } from '@/shared/api/error-message'

const props = defineProps<{ selected: string }>()
const emit = defineEmits<{ select: [id: string] }>()
const { t } = useI18n()
const query = useFolders(),
  actions = useFolderActions(),
  canWrite = useCan('write')
const editing = ref(false),
  editId = ref(''),
  deleting = ref(false),
  form = ref<FormInst>()
const draft = ref({ name: '', parentId: null as string | null }),
  baseline = ref('')
const current = computed(() => query.data.value?.find((folder) => folder.id === props.selected))
const pending = computed(() => actions.save.isPending.value || actions.remove.isPending.value)
const { canLeave } = useEditGuard(
  () => editing.value && JSON.stringify(draft.value) !== baseline.value,
  pending,
)
const tree = computed<TreeOption[]>(() => {
  const folders = query.data.value ?? []
  function children(parentId: string | null): TreeOption[] {
    return folders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => ({ key: folder.id, label: folder.name, children: children(folder.id) }))
  }
  return children(null)
})
const deleteError = computed(() => {
  const error = actions.remove.error.value
  if (error instanceof ApiError && error.code === 'DEPENDENCY_CONFLICT')
    return t('folders.notEmpty')
  return error ? t(errorKey(error)) : undefined
})
function open(edit = false) {
  editId.value = edit ? (current.value?.id ?? '') : ''
  draft.value =
    edit && current.value
      ? { name: current.value.name, parentId: current.value.parentId }
      : { name: '', parentId: current.value?.id ?? null }
  baseline.value = JSON.stringify(draft.value)
  actions.save.reset()
  editing.value = true
}
function close() {
  if (canLeave()) editing.value = false
}
function confirmDelete() {
  actions.remove.reset()
  deleting.value = true
}
async function save() {
  if (pending.value || !canWrite.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (pending.value || !canWrite.value) return
  try {
    const folder = await actions.save.mutateAsync({
      id: editId.value || undefined,
      body: { ...draft.value, name: draft.value.name.trim() },
    })
    editing.value = false
    emit('select', folder.id)
  } catch {
    /* The form retains the failed draft. */
  }
}
async function remove() {
  if (pending.value || !current.value || !canWrite.value) return
  try {
    await actions.remove.mutateAsync(current.value.id)
    deleting.value = false
    emit('select', '')
  } catch {
    /* The confirmation owns the error. */
  }
}
</script>
<template>
  <NCard :title="t('folders.title')" :bordered="false" size="small">
    <NSpace vertical>
      <NButton block :type="!selected ? 'primary' : 'default'" @click="emit('select', '')">{{
        t('folders.all')
      }}</NButton>
      <NButton
        block
        :type="selected === 'none' ? 'primary' : 'default'"
        @click="emit('select', 'none')"
        >{{ t('folders.unfiled') }}</NButton
      >
      <AsyncState
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty="!query.data.value?.length"
        @retry="query.refetch()"
      >
        <NTree
          :data="tree"
          :selected-keys="[selected]"
          :cancelable="false"
          default-expand-all
          block-line
          :aria-label="t('folders.title')"
          @update:selected-keys="emit('select', String($event[0] ?? ''))"
        />
      </AsyncState>
      <NSpace>
        <NButton
          size="small"
          :disabled="!canWrite || !!query.error.value || query.isLoading.value"
          @click="open()"
          >{{ t('folders.create') }}</NButton
        >
        <NButton size="small" :disabled="!canWrite || !current" @click="open(true)">{{
          t('folders.edit')
        }}</NButton>
        <NButton
          size="small"
          type="error"
          :disabled="!canWrite || !current"
          @click="confirmDelete"
          >{{ t('folders.delete') }}</NButton
        >
      </NSpace>
      <p class="hint">{{ t('folders.scope') }}</p>
    </NSpace>
  </NCard>
  <NModal
    :aria-label="editId ? t('folders.edit') : t('folders.create')"
    :show="editing"
    preset="card"
    :title="editId ? t('folders.edit') : t('folders.create')"
    style="width: min(500px, calc(100vw - 32px))"
    :closable="!pending"
    :mask-closable="!pending"
    :close-on-esc="!pending"
    @close="close"
    @update:show="!$event && close()"
  >
    <NForm
      ref="form"
      :model="draft"
      :disabled="pending"
      label-placement="top"
      :rules="{
        name: {
          required: true,
          whitespace: true,
          max: 80,
          message: t('folders.invalidName'),
          trigger: 'blur',
        },
      }"
    >
      <NFormItem :label="t('folders.name')" path="name"
        ><NInput
          autofocus
          v-model:value="draft.name"
          :input-props="{ 'aria-label': t('folders.name') }"
          :maxlength="80"
      /></NFormItem>
      <NFormItem :label="t('folders.parent')"
        ><DatasetFolderSelect
          v-model="draft.parentId"
          :label="t('folders.parent')"
          :empty-label="t('folders.root')"
          :exclude-id="editId || undefined"
          :disabled="pending"
      /></NFormItem>
    </NForm>
    <NAlert v-if="actions.save.error.value" type="error">{{
      t(errorKey(actions.save.error.value))
    }}</NAlert>
    <template #footer
      ><NSpace justify="end"
        ><NButton :disabled="pending" @click="close">{{ t('cancel') }}</NButton
        ><NButton type="primary" :loading="pending" :disabled="!canWrite" @click="save">{{
          t('save')
        }}</NButton></NSpace
      ></template
    >
  </NModal>
  <ConfirmDialog
    :show="deleting"
    :title="t('folders.delete')"
    :description="t('folders.deleteHint', { name: current?.name ?? '' })"
    :pending="actions.remove.isPending.value"
    :error="deleteError"
    @confirm="remove"
    @cancel="deleting = false"
  />
</template>
<style scoped>
.hint {
  color: var(--textSecondary);
  font-size: 12px;
  margin-bottom: 0;
}
</style>
