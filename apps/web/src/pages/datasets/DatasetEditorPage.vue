<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Layers, Plus, Save } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NTag,
  type FormInst,
} from 'naive-ui'
import {
  useDatasetEditor,
  sourceFieldType,
  DatasetSqlWorkspace,
  DatasetPreviewPanel,
  DatasetDeliverySettings,
} from '@/modules/datasets'
import { SourcePicker, SourceObjectList, useSource, useSourceObjects } from '@/modules/sources'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { TagEditor } from '@/shared/ui/tag-editor'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { useCan } from '@/shared/security/permissions'

const route = useRoute(),
  router = useRouter(),
  { t } = useI18n()
const id = computed(() => String(route.params.id ?? ''))
const { query, draft, dirty, save, preview } = useDatasetEditor(id)
const source = useSource(() => draft.value.definition.sourceId)
const objects = useSourceObjects(() => draft.value.definition.sourceId)
const canReadSensitive = useCan('readSensitive')
const submitting = ref(false)
const requestBusy = computed(() => save.isPending.value || preview.isPending.value)
const busy = computed(() => requestBusy.value || submitting.value)
const form = ref<FormInst>()
const saving = ref(false)
const sqlWorkspace = ref<InstanceType<typeof DatasetSqlWorkspace>>()
const referenceId = ref('')
const selectedObject = computed(() =>
  objects.data.value?.find((o) => o.id === draft.value.definition.objectId),
)
const referenceObject = computed(
  () => objects.data.value?.find((o) => o.id === referenceId.value) ?? objects.data.value?.[0],
)
const database = computed(() => source.data.value?.settings.database ?? '')
const schema = computed(() => {
  const tables = Object.fromEntries(
    (objects.data.value ?? []).map((object) => [
      object.name,
      {
        self: { label: object.name, type: 'type', detail: t('datasets.tableMode') },
        children: object.fields.map((field) => ({
          label: field.name,
          type: 'property',
          detail: field.type,
          info: field.description,
        })),
      },
    ]),
  )
  return database.value ? { [database.value]: tables } : tables
})
const definitionReady = computed(() => {
  const definition = draft.value.definition
  return (
    !!definition.sourceId &&
    (definition.mode === 'sql'
      ? !!definition.sql.trim()
      : !!selectedObject.value?.fields.length && !objects.isFetching.value)
  )
})
if (!id.value) {
  draft.value.definition.sourceId = String(route.query.sourceId ?? '')
  draft.value.definition.objectId = String(route.query.objectId ?? '')
}
watch(
  () => draft.value.definition.sourceId,
  () => {
    referenceId.value = ''
  },
)
watch(
  [
    () => objects.data.value,
    () => draft.value.definition.mode,
    () => draft.value.definition.objectId,
  ],
  ([items, mode, objectId]) => {
    if (mode !== 'visual' || draft.value.definition.fields.length) return
    const object = items?.find((item) => item.id === objectId)
    if (object)
      draft.value.definition.fields = object.fields.map((field) => ({
        ...field,
        type: sourceFieldType(field.type),
        output:
          !id.value && typeof route.query.field === 'string'
            ? field.name === route.query.field
            : field.output,
      }))
  },
  { immediate: true },
)
function selectSource(value: string) {
  if (draft.value.definition.sourceId === value) return
  draft.value.definition.sourceId = value
  draft.value.definition.objectId = ''
  draft.value.definition.fields = []
}
function selectObject(value: string) {
  if (busy.value) return
  if (draft.value.definition.mode === 'sql') {
    referenceId.value = value
    return
  }
  if (draft.value.definition.objectId === value) return
  draft.value.definition.objectId = value
  draft.value.definition.fields = []
}
function selectDefinitionMode(value: 'visual' | 'sql') {
  if (draft.value.definition.mode === value) return
  draft.value.definition.mode = value
  draft.value.definition.fields = []
  draft.value.definition.objectId = ''
}
function quoteIdentifier(value: string) {
  return '`' + value.replaceAll('`', '``') + '`'
}
function insertTable() {
  if (!referenceObject.value) return
  const name = quoteIdentifier(referenceObject.value.name)
  sqlWorkspace.value?.insertText(draft.value.definition.sql.trim() ? name : 'SELECT * FROM ' + name)
}
async function define() {
  if (!definitionReady.value || requestBusy.value) return false
  return preview.define(selectedObject.value?.fields)
}
async function submit() {
  if (!definitionReady.value || busy.value) return
  submitting.value = true
  try {
    await form.value?.validate()
    if (!preview.definitionCurrent.value && !(await define())) return
    const saved = await save.mutateAsync()
    saving.value = false
    submitting.value = false
    await router.push('/datasets/' + saved.id)
  } catch {
  } finally {
    submitting.value = false
  }
}
useEditGuard(dirty, busy)
</script>
<template>
  <div class="dataset-editor">
    <header class="editor-header">
      <div class="editor-identity">
        <Layers :size="20" aria-hidden="true" />
        <h1>{{ id ? t('ui.dataset_editor_3dabd36c') : t('ui.dataset_editor_e78bd5fa') }}</h1>
        <span v-if="draft.name" class="editor-name" :title="draft.name">{{ draft.name }}</span>
        <NTag size="small" :bordered="false">{{
          dirty ? t('datasets.editor.unsaved') : t('datasets.editor.draft')
        }}</NTag>
      </div>
      <div class="header-actions">
        <slot name="workspace-actions" />
        <NButton :disabled="busy" @click="router.push(id ? '/datasets/' + id : '/datasets')">{{
          t('datasets.editor.exit')
        }}</NButton>
        <NButton type="primary" :disabled="!definitionReady || busy" @click="saving = true">
          <template #icon><Save :size="16" /></template>{{ t('save') }}
        </NButton>
      </div>
    </header>
    <AsyncState
      :loading="!!id && query.isLoading.value"
      :error="query.error.value"
      @retry="query.refetch()"
    >
      <main class="editor-main">
        <aside class="definition-sidebar">
          <div class="definition-settings">
            <NFormItem :label="t('datasets.definitionMode')">
              <NSelect
                :value="draft.definition.mode"
                :disabled="busy"
                v-select-trigger-name="t('datasets.definitionMode')"
                :options="[
                  { label: t('datasets.tableMode'), value: 'visual' },
                  { label: t('datasets.sqlMode'), value: 'sql' },
                ]"
                @update:value="selectDefinitionMode"
              />
            </NFormItem>
            <NFormItem :label="t('ui.dataset_editor_a3ccf702')">
              <SourcePicker
                :value="draft.definition.sourceId"
                :disabled="busy"
                :label="t('ui.dataset_editor_a3ccf702')"
                @update:value="selectSource"
              />
            </NFormItem>
          </div>
          <div class="object-catalog">
            <AsyncState
              :loading="objects.isLoading.value"
              :error="objects.error.value"
              @retry="objects.refetch()"
            >
              <SourceObjectList
                :objects="objects.data.value ?? []"
                :object-id="
                  draft.definition.mode === 'sql'
                    ? (referenceObject?.id ?? '')
                    : draft.definition.objectId
                "
                @select="selectObject"
              />
            </AsyncState>
          </div>
          <section
            v-if="draft.definition.mode === 'sql' && referenceObject"
            class="field-reference"
            :aria-label="t('sources.fields')"
          >
            <header>
              <strong :title="referenceObject.name">{{ referenceObject.name }}</strong>
              <CopyButton :value="referenceObject.name" />
              <NButton
                quaternary
                size="small"
                :disabled="busy"
                :aria-label="t('datasets.editor.insertTable')"
                :title="t('datasets.editor.insertTable')"
                @click="insertTable"
                ><template #icon><Plus :size="16" /></template
              ></NButton>
            </header>
            <ul>
              <li
                v-for="field in referenceObject.fields"
                :key="field.name"
                :title="field.description"
              >
                <NButton
                  text
                  :disabled="busy"
                  :title="t('datasets.editor.insertField', { name: field.name })"
                  @click="sqlWorkspace?.insertText(quoteIdentifier(field.name))"
                  >{{ field.name }}</NButton
                >
                <small>{{ field.type }}</small
                ><CopyButton :value="field.name" />
              </li>
            </ul>
          </section>
        </aside>
        <section class="definition-workspace">
          <NAlert
            v-if="preview.schemaChanges.value?.removed.length"
            type="warning"
            :show-icon="false"
            class="schema-notice"
            >{{
              t('datasets.schemaRemoved', {
                fields: preview.schemaChanges.value.removed.join('、'),
              })
            }}</NAlert
          >
          <DatasetSqlWorkspace
            v-if="draft.definition.mode === 'sql'"
            ref="sqlWorkspace"
            v-model="draft.definition.sql"
            :pending="busy"
            :disabled="!canReadSensitive || !definitionReady || busy"
            :schema="schema"
            :database="database"
            :result="preview.definitionData.value"
            :failed="preview.definitionFailed.value"
            @run="define"
          />
          <template v-else>
            <div class="table-toolbar">
              <strong>{{ selectedObject?.name ?? t('datasets.editor.chooseTable') }}</strong>
              <NButton
                type="primary"
                :disabled="!canReadSensitive || !definitionReady || busy"
                :loading="preview.isPending.value"
                @click="define"
                >{{ t('datasets.editor.readTable') }}</NButton
              >
            </div>
            <div class="table-preview">
              <DatasetPreviewPanel
                kind="definition"
                :result="preview.definitionData.value"
                :pending="preview.isPending.value"
                :failed="preview.definitionFailed.value"
              />
            </div>
          </template>
        </section>
      </main>
    </AsyncState>
    <NModal
      :aria-label="t('datasets.editor.deliver')"
      :show="saving"
      preset="card"
      class="dataset-save-dialog"
      :title="t('datasets.editor.deliver')"
      :style="{ width: '680px', maxHeight: '85vh', overflowY: 'auto' }"
      :closable="!busy"
      :mask-closable="!busy"
      :close-on-esc="!busy"
      @update:show="saving = $event"
    >
      <NForm
        ref="form"
        :model="draft"
        label-placement="top"
        :disabled="busy"
        :rules="{
          name: {
            required: true,
            validator: (_rule, value: string) => !!value?.trim(),
            message: t('ui.dataset_editor_505e9598'),
            trigger: 'blur',
          },
        }"
      >
        <NFormItem :label="t('ui.dataset_editor_5aa625bf')" path="name"
          ><NInput
            v-model:value="draft.name"
            :input-props="{ 'aria-label': t('ui.dataset_editor_5aa625bf') }"
        /></NFormItem>
        <NFormItem :label="t('ui.dataset_editor_974d383f')"
          ><NInput
            v-model:value="draft.owner"
            :input-props="{ 'aria-label': t('ui.dataset_editor_974d383f') }"
        /></NFormItem>
        <NFormItem :label="t('ui.dataset_editor_ae0a7afe')"
          ><TagEditor v-model="draft.tags" :disabled="busy"
        /></NFormItem>
        <NFormItem :label="t('ui.dataset_editor_26670dda')"
          ><NInput
            v-model:value="draft.description"
            :input-props="{ 'aria-label': t('ui.dataset_editor_26670dda') }"
        /></NFormItem>
        <DatasetDeliverySettings
          v-model="draft.definition"
          :subject-domain-label="t('warehouse.subjectDomain')"
          :subject-domain-hint="t('warehouse.domainHint')"
          :locked="(query.data.value?.publishedVersion ?? 0) > 0"
          :disabled="busy"
        />
      </NForm>
      <template #footer
        ><div class="save-actions">
          <NButton :disabled="busy" @click="saving = false">{{ t('cancel') }}</NButton
          ><NButton
            type="primary"
            :disabled="!definitionReady || busy"
            :loading="busy"
            @click="submit"
            >{{ t('ui.dataset_editor_4cd30ef9') }}</NButton
          >
        </div></template
      >
    </NModal>
  </div>
</template>
<style scoped>
.dataset-editor {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--textPrimary);
}
.editor-header {
  height: 64px;
  flex-shrink: 0;
  padding: 0 24px;
  background: var(--surfaceRaised);
  border-bottom: 1px solid var(--border);
  justify-content: space-between;
}
.editor-header,
.editor-identity,
.header-actions,
.save-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.editor-identity {
  min-width: 0;
}
h1 {
  font-size: 18px;
  margin: 0;
  white-space: nowrap;
}
.editor-name {
  color: var(--textSecondary);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-main {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.definition-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surfaceRaised);
  border-right: 1px solid var(--border);
}
.definition-settings {
  padding: 20px 20px 0;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.definition-settings :deep(.n-form-item) {
  --n-label-height: 24px;
}
.object-catalog {
  flex: 1;
  min-height: 160px;
  overflow: hidden;
}
.field-reference {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  max-height: 44%;
  border-top: 1px solid var(--border);
  padding: 12px 16px;
}
.field-reference header,
.field-reference li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.field-reference strong {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.field-reference ul {
  flex: 1;
  min-height: 0;
  overflow: auto;
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}
.field-reference li {
  min-height: 32px;
}
.field-reference li :deep(.n-button) {
  min-width: 0;
}
.field-reference li :deep(.n-button__content) {
  overflow: hidden;
  text-overflow: ellipsis;
}
.field-reference small {
  margin-left: auto;
  color: var(--textSecondary);
  white-space: nowrap;
}
.definition-workspace {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 16px 20px;
}
.schema-notice {
  flex-shrink: 0;
  margin-bottom: 12px;
}
.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  margin-bottom: 12px;
}
.table-preview {
  flex: 1;
  min-height: 0;
}
.save-actions {
  justify-content: flex-end;
}
</style>
