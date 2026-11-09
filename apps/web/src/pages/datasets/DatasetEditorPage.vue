<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Layers, Plus, Save } from 'lucide-vue-next'
import { NAlert, NButton, NForm, NFormItem, NInput, NSelect, NTag, NTabs, NTabPane } from 'naive-ui'
import {
  useDatasetEditor,
  useDatasetVersion,
  sourceFieldType,
  DatasetSqlWorkspace,
  DatasetPreviewPanel,
  DatasetDeliverySettings,
  DatasetNameEditor,
} from '@/modules/datasets'
import { SourcePicker, SourceObjectList, useSource, useSourceObjects } from '@/modules/sources'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { TagEditor } from '@/shared/ui/tag-editor'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { useCan } from '@/shared/security/permissions'
import { vAccessibleTabs } from '@/shared/ui/accessible-tabs'
import { ApiError } from '@/shared/api/client'

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
const nameEditor = ref<InstanceType<typeof DatasetNameEditor>>()
const deliverySettings = ref<InstanceType<typeof DatasetDeliverySettings>>()
const sidebarTab = ref('source')
const publishedVersion = useDatasetVersion(id, () =>
  String(query.data.value?.publishedVersion || ''),
)
const sqlWorkspace = ref<InstanceType<typeof DatasetSqlWorkspace>>()
const referenceId = ref('')
const selectedObject = computed(() =>
  objects.data.value?.find((o) => o.id === draft.value.definition.objectId),
)
const referenceObject = computed(() => objects.data.value?.find((o) => o.id === referenceId.value))
const tableKeyOptions = computed(() =>
  draft.value.definition.fields
    .filter((field) => field.output)
    .map(({ name, target }) => ({
      label: name === target ? name : name + ' → ' + target,
      value: target,
    })),
)
const sqlDefaultSchema = computed(() => {
  const current = source.data.value
  if (current?.type === 'PostgreSQL') return current.settings.schema || 'public'
  return current?.settings.database ?? ''
})
const schema = computed(() => {
  const tables = Object.fromEntries(
    (objects.data.value ?? []).map((object) => [
      source.data.value?.type === 'PostgreSQL' ? object.name.replaceAll('.', '\\.') : object.name,
      {
        self: {
          label: object.name,
          type: 'type',
          detail: t('datasets.tableMode'),
          ...(source.data.value?.type === 'PostgreSQL'
            ? { apply: quoteIdentifier(object.name) }
            : {}),
        },
        children: object.fields.map((field) => ({
          label: field.name,
          type: 'property',
          detail: field.type,
          info: field.description,
          ...(source.data.value?.type === 'PostgreSQL'
            ? { apply: quoteIdentifier(field.name) }
            : {}),
        })),
      },
    ]),
  )
  return sqlDefaultSchema.value ? { [sqlDefaultSchema.value]: tables } : tables
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
// File sources expose worksheets, so selecting one leaves the SQL editor mode.
watch(
  () => source.data.value?.type,
  (type) => {
    if (type === 'Excel' && draft.value.definition.mode === 'sql') selectDefinitionMode('visual')
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
  draft.value.definition.output.keys = []
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
  draft.value.definition.output.keys = []
}
function selectDefinitionMode(value: 'visual' | 'sql') {
  if (draft.value.definition.mode === value) return
  if (value === 'sql') referenceId.value = draft.value.definition.objectId
  draft.value.definition.mode = value
  draft.value.definition.fields = []
  draft.value.definition.objectId = ''
}
function quoteIdentifier(value: string) {
  const quote = source.data.value?.type === 'PostgreSQL' ? '"' : '`'
  return quote + value.replaceAll(quote, quote + quote) + quote
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
    if (!(await nameEditor.value?.commit())) {
      submitting.value = false
      await nameEditor.value?.focus()
      return
    }
    if (!preview.definitionCurrent.value && !(await define())) return
    const saved = await save.mutateAsync()
    submitting.value = false
    await router.push('/datasets/' + saved.id)
  } catch (error) {
    if (
      error instanceof ApiError &&
      [
        'TARGET_NAME_INVALID',
        'TARGET_NAME_IMMUTABLE',
        'OUTPUT_UNSUPPORTED',
        'DATASET_DELIVERY_MODE_IMMUTABLE',
      ].includes(error.code)
    ) {
      sidebarTab.value = 'settings'
      submitting.value = false
      await nextTick()
      deliverySettings.value?.focusTarget()
    }
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
        <DatasetNameEditor
          :key="id"
          ref="nameEditor"
          v-model="draft.name"
          :placeholder="t('ui.dataset_editor_e78bd5fa')"
          :disabled="busy || (!!id && query.isLoading.value)"
        />
        <NTag size="small" :bordered="false">{{
          dirty ? t('datasets.editor.unsaved') : t('datasets.editor.draft')
        }}</NTag>
      </div>
      <div class="header-source-controls">
        <div class="header-definition">
          <span>{{ t('datasets.definitionMode') }}</span>
          <NSelect
            v-select-trigger-name="t('datasets.definitionMode')"
            size="small"
            :value="draft.definition.mode"
            :disabled="busy || (!!id && query.isLoading.value)"
            :options="[
              { label: t('datasets.tableMode'), value: 'visual' },
              {
                label: t('datasets.sqlMode'),
                value: 'sql',
                disabled: source.data.value?.type === 'Excel',
              },
            ]"
            @update:value="selectDefinitionMode"
          />
        </div>
        <div class="header-source">
          <span>{{ t('ui.dataset_editor_a3ccf702') }}</span>
          <SourcePicker
            compact
            :value="draft.definition.sourceId"
            :disabled="busy || (!!id && query.isLoading.value)"
            :label="t('ui.dataset_editor_a3ccf702')"
            @update:value="selectSource"
          />
        </div>
      </div>
      <div class="header-actions">
        <slot name="workspace-actions" />
        <NButton :disabled="busy" @click="router.push(id ? '/datasets/' + id : '/datasets')">{{
          t('datasets.editor.exit')
        }}</NButton>
        <NButton
          type="primary"
          :disabled="!definitionReady || busy"
          :loading="submitting"
          @click="submit"
        >
          <template #icon><Save :size="16" /></template>{{ t('ui.dataset_editor_4cd30ef9') }}
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
          <NTabs
            v-accessible-tabs="t('datasets.editor.sidebar')"
            v-model:value="sidebarTab"
            class="sidebar-tabs"
            type="line"
            justify-content="space-evenly"
            :animated="false"
            :pane-wrapper-style="{ flex: '1', minHeight: '0', overflow: 'hidden' }"
            :pane-style="{ height: '100%', minHeight: '0', padding: '0' }"
          >
            <NTabPane name="source" :tab="t('datasets.editor.sourceTab')" display-directive="show">
              <div class="source-panel">
                <div class="object-catalog">
                  <AsyncState
                    :loading="objects.isLoading.value"
                    :error="objects.error.value"
                    @retry="objects.refetch()"
                  >
                    <SourceObjectList
                      :objects="objects.data.value ?? []"
                      :heading="
                        draft.definition.mode !== 'visual'
                          ? undefined
                          : source.data.value?.type === 'Excel'
                            ? t('datasets.editor.chooseWorksheet')
                            : t('datasets.editor.chooseSourceTable')
                      "
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
                  v-if="draft.definition.mode === 'sql'"
                  class="field-reference"
                  :aria-label="t('datasets.sourceReference')"
                >
                  <h2>{{ t('datasets.sourceReference') }}</h2>
                  <p v-if="!referenceObject" class="reference-hint">
                    {{ t('datasets.editor.chooseReferenceTable') }}
                  </p>
                  <template v-else>
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
                  </template>
                </section>
                <section
                  v-else-if="selectedObject && draft.definition.deliveryMode === 'warehouse'"
                  class="table-keys"
                  :aria-label="t('datasets.editor.tableKeys')"
                >
                  <h2>{{ t('datasets.editor.tableKeys') }}</h2>
                  <NFormItem :label="t('datasets.output.keys')" :show-feedback="false">
                    <NSelect
                      v-model:value="draft.definition.output.keys"
                      v-select-trigger-name="t('datasets.output.keys')"
                      multiple
                      clearable
                      :disabled="busy"
                      :options="tableKeyOptions"
                    />
                  </NFormItem>
                  <p class="reference-hint">{{ t('datasets.editor.tableKeysHint') }}</p>
                </section>
              </div>
            </NTabPane>
            <NTabPane
              name="settings"
              :tab="t('datasets.editor.settingsTab')"
              display-directive="show"
            >
              <NForm class="editor-settings" :model="draft" label-placement="top" :disabled="busy">
                <DatasetDeliverySettings
                  ref="deliverySettings"
                  v-model="draft.definition"
                  :subject-domain-label="t('warehouse.subjectDomain')"
                  :subject-domain-hint="t('warehouse.domainHint')"
                  :locked="(query.data.value?.publishedVersion ?? 0) > 0"
                  :disabled="busy"
                  :published-output="publishedVersion.data.value?.definition.output"
                  :published-version="query.data.value?.publishedVersion"
                >
                  <template #metadata>
                    <NFormItem :label="t('ui.dataset_editor_974d383f')" :show-feedback="false"
                      ><NInput
                        v-model:value="draft.owner"
                        :input-props="{ 'aria-label': t('ui.dataset_editor_974d383f') }"
                    /></NFormItem>
                    <NFormItem :label="t('ui.dataset_editor_ae0a7afe')" :show-feedback="false"
                      ><TagEditor v-model="draft.tags" :disabled="busy"
                    /></NFormItem>
                    <NFormItem :label="t('ui.dataset_editor_26670dda')" :show-feedback="false"
                      ><NInput
                        v-model:value="draft.description"
                        :input-props="{ 'aria-label': t('ui.dataset_editor_26670dda') }"
                    /></NFormItem>
                  </template>
                </DatasetDeliverySettings>
                <NAlert v-if="publishedVersion.isError.value" type="warning" :show-icon="false"
                  >{{ t('datasets.output.activeLoadFailed') }}
                  <NButton text @click="publishedVersion.refetch()">{{
                    t('retry')
                  }}</NButton></NAlert
                >
              </NForm>
            </NTabPane>
          </NTabs>
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
            :default-schema="sqlDefaultSchema"
            :postgresql="source.data.value?.type === 'PostgreSQL'"
            :result="preview.definitionData.value"
            :failed="preview.definitionFailed.value"
            @run="define"
          />
          <template v-else>
            <div class="table-toolbar">
              <strong :title="selectedObject?.name">{{
                selectedObject?.name ?? t('datasets.editor.chooseTable')
              }}</strong>
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
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.editor-identity {
  flex: 1;
  min-width: 0;
}
.header-source-controls {
  flex-shrink: 0;
  display: flex;
  align-items: start;
  gap: 12px;
}
.header-source-controls span {
  display: block;
  margin-bottom: 2px;
  color: var(--textSecondary);
  font-size: 12px;
}
.header-definition {
  width: 132px;
}
.header-source {
  width: 200px;
}
.header-actions {
  flex-shrink: 0;
}
.editor-settings {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  padding: 20px;
}
.sidebar-tabs,
.source-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
.object-catalog {
  flex: 1;
  min-height: 160px;
  overflow: hidden;
}
.field-reference {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 44%;
  border-top: 1px solid var(--border);
  padding: 12px 16px;
}
.table-keys {
  max-height: 44%;
  overflow: auto;
  border-top: 1px solid var(--border);
  padding: 12px 16px;
}
.field-reference h2,
.table-keys h2 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
}
.reference-hint {
  margin: 8px 0 0;
  color: var(--textSecondary);
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
.table-toolbar strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.table-toolbar :deep(.n-button) {
  flex-shrink: 0;
}
.table-preview {
  flex: 1;
  min-height: 0;
}
</style>
