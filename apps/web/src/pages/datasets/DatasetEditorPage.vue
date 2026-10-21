<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Layers } from 'lucide-vue-next'
import {
  NAlert,
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NFormItemGi,
  NGrid,
  NInput,
  NSelect,
  NTag,
  type FormInst,
} from 'naive-ui'
import {
  useDatasetEditor,
  sourceFieldType,
  DatasetFields,
  DatasetGraph,
  DatasetSqlWorkspace,
  DatasetPreviewPanel,
  DatasetDeliverySettings,
} from '@/modules/datasets'
import { SourcePicker, SourceObjectList, useSourceObjects } from '@/modules/sources'
import { GovernanceBindingSelect } from '@/modules/governance'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { TagEditor } from '@/shared/ui/tag-editor'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useRouteTab } from '@/shared/composables/use-route-tab'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { useCan } from '@/shared/security/permissions'

const route = useRoute(),
  router = useRouter(),
  { t } = useI18n()
const canReadSensitive = useCan('readSensitive')
const id = computed(() => String(route.params.id ?? ''))
const { query, draft, dirty, save, preview } = useDatasetEditor(id)
const objects = useSourceObjects(() => draft.value.definition.sourceId)
const busy = computed(() => save.isPending.value || preview.isPending.value)
const form = ref<FormInst>()
const requestedStage = useRouteTab(['input', 'fields', 'output'], 'input')
const stage = computed(() => {
  if (!preview.definitionCurrent.value) return 'input'
  if (requestedStage.value === 'output' && !preview.data.value) return 'fields'
  return requestedStage.value
})
const steps = [
  { value: 'input', labelKey: 'datasets.editor.define' },
  { value: 'fields', labelKey: 'datasets.editor.process' },
  { value: 'output', labelKey: 'datasets.editor.deliver' },
] as const
const selectedObject = computed(() =>
  objects.data.value?.find((object) => object.id === draft.value.definition.objectId),
)
const referenceId = ref('')
const referenceObject = computed(
  () =>
    objects.data.value?.find((object) => object.id === referenceId.value) ??
    objects.data.value?.[0],
)
const definitionReady = computed(() => {
  const definition = draft.value.definition
  if (!definition.sourceId) return false
  return definition.mode === 'sql'
    ? !!definition.sql.trim()
    : !!selectedObject.value?.fields.length && !objects.isFetching.value
})
const processingReady = computed(
  () =>
    preview.definitionCurrent.value && draft.value.definition.fields.some((field) => field.output),
)
const saveReady = computed(() => processingReady.value && !!preview.data.value && !busy.value)
const progressHint = computed(() => {
  if (!preview.definitionCurrent.value) return 'datasets.editor.needDefinition'
  if (!preview.data.value) return 'datasets.editor.needProcessing'
  return 'datasets.editor.ready'
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
    if (mode !== 'visual') return
    const object = items?.find((item) => item.id === objectId)
    if (object && !draft.value.definition.fields.length) {
      draft.value.definition.fields = object.fields.map((field) => ({
        ...field,
        type: sourceFieldType(field.type),
        output:
          !id.value && typeof route.query.field === 'string'
            ? field.name === route.query.field
            : field.output,
      }))
    }
  },
  { immediate: true },
)
function selectSource(value: string) {
  draft.value.definition.sourceId = value
  draft.value.definition.objectId = ''
  draft.value.definition.fields = []
}
function selectObject(value: string) {
  if (busy.value || draft.value.definition.objectId === value) return
  draft.value.definition.objectId = value
  draft.value.definition.fields = []
}
function selectDefinitionMode(value: 'visual' | 'sql') {
  if (draft.value.definition.mode === value) return
  draft.value.definition.mode = value
  draft.value.definition.fields = []
  draft.value.definition.objectId = ''
}
async function define() {
  if (!definitionReady.value || busy.value) return
  await preview.define(selectedObject.value?.fields)
}
async function process() {
  if (!processingReady.value || busy.value) return
  await preview.run()
}
async function submit() {
  if (!saveReady.value || stage.value !== 'output') return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (busy.value) return
  try {
    const saved = await save.mutateAsync()
    await router.push('/datasets/' + saved.id)
  } catch {}
}
useEditGuard(dirty, busy)
</script>
<template>
  <div class="dataset-editor">
    <header class="editor-header">
      <div class="editor-identity">
        <span class="editor-mark" aria-hidden="true"><Layers :size="18" /></span>
        <h1>{{ id ? t('ui.dataset_editor_3dabd36c') : t('ui.dataset_editor_e78bd5fa') }}</h1>
        <span v-if="draft.name" class="editor-name" :title="draft.name">{{ draft.name }}</span>
        <NTag size="small" :bordered="false">{{
          dirty ? t('datasets.editor.unsaved') : t('datasets.editor.draft')
        }}</NTag>
      </div>
      <div class="header-actions">
        <slot name="workspace-actions" />
        <NButton :disabled="busy" @click="router.push(id ? '/datasets/' + id : '/datasets')">
          {{ t('datasets.editor.exit') }}
        </NButton>
      </div>
    </header>
    <nav class="editor-steps" :aria-label="t('datasets.editor.steps')">
      <NButton
        v-for="(step, index) in steps"
        :key="step.value"
        quaternary
        :type="stage === step.value ? 'primary' : 'default'"
        :aria-current="stage === step.value ? 'step' : undefined"
        :disabled="
          busy ||
          (step.value !== 'input' && !preview.definitionCurrent.value) ||
          (step.value === 'output' && !preview.data.value)
        "
        @click="requestedStage = step.value"
      >
        <span class="step-number">{{ index + 1 }}</span
        >{{ t(step.labelKey) }}
      </NButton>
    </nav>
    <AsyncState
      :loading="!!id && query.isLoading.value"
      :error="query.error.value"
      @retry="query.refetch()"
    >
      <main class="editor-main">
        <section v-if="stage === 'input'" class="definition-stage">
          <div class="definition-settings">
            <NFormItem :label="t('ui.dataset_editor_a3ccf702')">
              <SourcePicker
                :value="draft.definition.sourceId"
                :disabled="busy"
                :label="t('ui.dataset_editor_a3ccf702')"
                @update:value="selectSource"
              />
            </NFormItem>
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
            <p>{{ t('datasets.editor.defineHint') }}</p>
          </div>
          <NAlert
            v-if="preview.schemaChanges.value?.removed.length"
            type="warning"
            :show-icon="false"
            class="schema-notice"
          >
            {{
              t('datasets.schemaRemoved', {
                fields: preview.schemaChanges.value.removed.join('、'),
              })
            }}
          </NAlert>
          <DatasetSqlWorkspace
            v-if="draft.definition.mode === 'sql'"
            v-model="draft.definition.sql"
            :pending="busy"
            :disabled="!canReadSensitive || !definitionReady || busy"
            :result="preview.definitionData.value"
            :failed="preview.definitionFailed.value"
            @run="define"
          >
            <template #reference>
              <AsyncState
                :loading="objects.isLoading.value"
                :error="objects.error.value"
                @retry="objects.refetch()"
              >
                <div class="sql-table-reference">
                  <SourceObjectList
                    :objects="objects.data.value ?? []"
                    :object-id="referenceObject?.id ?? ''"
                    @select="referenceId = $event"
                  />
                </div>
                <section class="sql-field-reference" :aria-label="t('sources.fields')">
                  <header v-if="referenceObject">
                    <strong>{{ referenceObject.name }}</strong
                    ><CopyButton :value="referenceObject.name" />
                  </header>
                  <p>{{ t('datasets.referenceHint') }}</p>
                  <ul>
                    <li
                      v-for="field in referenceObject?.fields ?? []"
                      :key="field.name"
                      :title="field.description"
                    >
                      <div>
                        <span>{{ field.name }}</span
                        ><CopyButton :value="field.name" />
                      </div>
                      <small>{{ field.type }}</small>
                    </li>
                  </ul>
                </section>
              </AsyncState>
            </template>
          </DatasetSqlWorkspace>
          <template v-else>
            <div class="stage-toolbar">
              <span>{{ selectedObject?.name ?? t('datasets.editor.chooseTable') }}</span>
              <NButton
                type="primary"
                :disabled="!canReadSensitive || !definitionReady || busy"
                :loading="preview.isPending.value"
                @click="define"
                >{{ t('datasets.editor.readTable') }}</NButton
              >
            </div>
            <div class="table-workspace">
              <div class="table-catalog">
                <AsyncState
                  :loading="objects.isLoading.value"
                  :error="objects.error.value"
                  @retry="objects.refetch()"
                >
                  <SourceObjectList
                    :objects="objects.data.value ?? []"
                    :object-id="draft.definition.objectId"
                    @select="selectObject"
                  />
                </AsyncState>
              </div>
              <DatasetPreviewPanel
                kind="definition"
                :result="preview.definitionData.value"
                :pending="preview.isPending.value"
                :failed="preview.definitionFailed.value"
              />
            </div>
          </template>
        </section>
        <section v-else-if="stage === 'fields'" class="processing-stage">
          <div class="stage-toolbar">
            <div>
              <h2>{{ t('datasets.editor.process') }}</h2>
              <p>{{ t('datasets.editor.processHint') }}</p>
            </div>
            <NButton
              type="primary"
              :disabled="!canReadSensitive || !processingReady || busy"
              :loading="preview.isPending.value"
              @click="process"
              >{{ t('datasets.editor.previewProcessing') }}</NButton
            >
          </div>
          <NAlert
            v-if="preview.schemaChanges.value?.removed.length"
            type="warning"
            :show-icon="false"
            class="schema-notice"
          >
            {{
              t('datasets.schemaRemoved', {
                fields: preview.schemaChanges.value.removed.join('、'),
              })
            }}
          </NAlert>
          <div class="processing-panes">
            <div class="processing-config">
              <DatasetFields v-model="draft.definition.fields" :readonly="busy">
                <template #mask-policy="{ field, disabled, update }">
                  <GovernanceBindingSelect
                    kind="masking"
                    single
                    size="small"
                    :value="field.maskPolicyId ? [field.maskPolicyId] : []"
                    :label="t('datasets.fieldPolicy', { name: field.name })"
                    :disabled="disabled"
                    @update:value="update($event[0] ?? '')"
                  />
                </template>
              </DatasetFields>
              <NForm label-placement="top" :disabled="busy" class="processing-rules">
                <NFormItem :label="t('ui.dataset_editor_16fda324')">
                  <NCheckboxGroup
                    v-model:value="draft.definition.cleaning"
                    :aria-label="t('ui.dataset_editor_16fda324')"
                  >
                    <NCheckbox value="trim">{{ t('ui.dataset_editor_d9f06fea') }}</NCheckbox>
                  </NCheckboxGroup>
                </NFormItem>
                <NCollapse :default-expanded-names="['governance']">
                  <NCollapseItem name="governance" :title="t('datasets.editor.governance')">
                    <NGrid :cols="2" :x-gap="20">
                      <NFormItemGi :label="t('ui.dataset_editor_e974beee')">
                        <GovernanceBindingSelect
                          kind="quality"
                          v-model:value="draft.definition.qualityRuleIds"
                          :label="t('ui.dataset_editor_e974beee')"
                          :disabled="busy"
                        />
                      </NFormItemGi>
                      <NFormItemGi :label="t('ui.dataset_editor_3792a310')">
                        <GovernanceBindingSelect
                          kind="masking"
                          v-model:value="draft.definition.maskPolicyIds"
                          :label="t('ui.dataset_editor_3792a310')"
                          :disabled="busy"
                        />
                      </NFormItemGi>
                    </NGrid>
                    <p class="muted">{{ t('datasets.sampleHint') }}</p>
                  </NCollapseItem>
                  <NCollapseItem
                    v-if="draft.definition.mode === 'visual'"
                    name="graph"
                    :title="t('datasets.editor.visualProcessing')"
                  >
                    <DatasetGraph
                      v-model:nodes="draft.definition.nodes"
                      v-model:edges="draft.definition.edges"
                      :readonly="busy"
                    />
                  </NCollapseItem>
                </NCollapse>
              </NForm>
            </div>
            <DatasetPreviewPanel
              kind="processing"
              :result="preview.data.value"
              :pending="preview.isPending.value"
              :failed="preview.failed.value"
            />
          </div>
        </section>
        <section v-else class="output-stage">
          <div class="stage-toolbar">
            <div>
              <h2>{{ t('datasets.editor.deliver') }}</h2>
              <p>{{ t('datasets.editor.deliverHint') }}</p>
            </div>
          </div>
          <div class="output-columns">
            <NForm
              ref="form"
              :model="draft"
              :rules="{
                name: {
                  required: true,
                  validator: (_rule, value: string) => !!value?.trim(),
                  message: t('ui.dataset_editor_505e9598'),
                  trigger: 'blur',
                },
              }"
              label-placement="top"
              :disabled="busy"
              class="output-form"
            >
              <NGrid :cols="2" :x-gap="20">
                <NFormItemGi :label="t('ui.dataset_editor_5aa625bf')" path="name">
                  <NInput
                    v-model:value="draft.name"
                    :input-props="{ 'aria-label': t('ui.dataset_editor_5aa625bf') }"
                    :placeholder="t('ui.dataset_editor_5aa625bf')"
                  />
                </NFormItemGi>
                <NFormItemGi :label="t('ui.dataset_editor_974d383f')">
                  <NInput
                    v-model:value="draft.owner"
                    :input-props="{ 'aria-label': t('ui.dataset_editor_974d383f') }"
                  />
                </NFormItemGi>
                <NFormItemGi :label="t('ui.dataset_editor_ae0a7afe')" :span="2"
                  ><TagEditor v-model="draft.tags" :disabled="busy"
                /></NFormItemGi>
                <NFormItemGi :label="t('ui.dataset_editor_26670dda')" :span="2">
                  <NInput
                    v-model:value="draft.description"
                    :input-props="{ 'aria-label': t('ui.dataset_editor_26670dda') }"
                  />
                </NFormItemGi>
              </NGrid>
              <DatasetDeliverySettings
                v-model="draft.definition"
                :subject-domain-label="t('warehouse.subjectDomain')"
                :subject-domain-hint="t('warehouse.domainHint')"
                :locked="(query.data.value?.publishedVersion ?? 0) > 0"
                :disabled="busy"
              />
            </NForm>
            <aside class="output-review" :aria-label="t('datasets.editor.review')">
              <h2>{{ t('datasets.editor.review') }}</h2>
              <dl>
                <dt>{{ t('datasets.definitionMode') }}</dt>
                <dd>
                  {{
                    draft.definition.mode === 'sql'
                      ? t('datasets.sqlMode')
                      : t('datasets.tableMode')
                  }}
                </dd>
                <dt>{{ t('datasets.editor.outputFields') }}</dt>
                <dd>{{ draft.definition.fields.filter((field) => field.output).length }}</dd>
                <dt>{{ t('datasets.editor.processingStatus') }}</dt>
                <dd>{{ t('datasets.editor.verified') }}</dd>
              </dl>
              <p>{{ t('datasets.editor.publishHint') }}</p>
            </aside>
          </div>
        </section>
      </main>
      <footer class="editor-footer">
        <span class="progress-hint">{{ t(progressHint) }}</span>
        <div class="footer-actions">
          <NButton
            v-if="stage !== 'input'"
            :disabled="busy"
            @click="requestedStage = stage === 'output' ? 'fields' : 'input'"
            >{{ t('datasets.editor.previous') }}</NButton
          >
          <NButton
            v-if="stage === 'input'"
            type="primary"
            :disabled="busy || !preview.definitionCurrent.value"
            @click="requestedStage = 'fields'"
            >{{ t('datasets.editor.nextProcessing') }}</NButton
          >
          <NButton
            v-else-if="stage === 'fields'"
            type="primary"
            :disabled="busy || !preview.data.value"
            @click="requestedStage = 'output'"
            >{{ t('datasets.editor.nextDelivery') }}</NButton
          >
          <NButton
            v-else
            type="primary"
            :disabled="!saveReady"
            :loading="save.isPending.value"
            @click="submit"
            >{{ t('ui.dataset_editor_4cd30ef9') }}</NButton
          >
        </div>
      </footer>
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
}
.editor-header,
.editor-identity,
.header-actions,
.editor-steps,
.stage-toolbar,
.editor-footer,
.footer-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.editor-header,
.stage-toolbar,
.editor-footer {
  justify-content: space-between;
}
.editor-identity {
  min-width: 0;
}
.editor-mark {
  background: var(--accentSoft);
  color: var(--accent);
  padding: 5px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}
h1 {
  font-size: 18px;
  margin: 0;
  white-space: nowrap;
}
.editor-name {
  color: var(--textSecondary);
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-steps {
  justify-content: center;
  flex-shrink: 0;
  height: 68px;
  border-bottom: 1px solid var(--border);
  background: var(--surfaceRaised);
}
.editor-steps :deep(.n-button) {
  padding: 0 24px;
}
.step-number {
  width: 23px;
  height: 23px;
  margin-right: 10px;
  border: 1px solid currentColor;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  font-size: 12px;
}
.editor-main,
.definition-stage,
.processing-stage {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.editor-main {
  padding: 16px 24px;
}
.definition-settings {
  display: grid;
  grid-template-columns: 320px 220px minmax(0, 1fr);
  gap: 20px;
  align-items: center;
}
.definition-settings :deep(.n-form-item) {
  --n-label-height: 24px;
}
.definition-settings > p,
.stage-toolbar p,
.progress-hint {
  color: var(--textSecondary);
  font-size: 12px;
}
.definition-settings > p {
  margin: 0 0 12px;
}
.table-workspace {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
  flex: 1;
}
.table-catalog {
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surfaceRaised);
  overflow: hidden;
}
.stage-toolbar {
  flex-shrink: 0;
  min-height: 42px;
  margin-bottom: 12px;
}
.stage-toolbar h2,
.output-review h2 {
  font-size: 16px;
  margin: 0;
}
.stage-toolbar p {
  margin: 4px 0 0;
}
.schema-notice {
  flex-shrink: 0;
  margin-bottom: 12px;
}
.processing-panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1.25fr) minmax(240px, 1fr);
  gap: 16px;
}
.processing-config {
  overflow: auto;
  min-height: 0;
  padding: 16px;
  background: var(--surfaceRaised);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.processing-rules {
  margin-top: 20px;
}
.output-stage {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.output-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  align-items: start;
  gap: 24px;
}
.output-form,
.output-review {
  padding: 24px;
  background: var(--surfaceRaised);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.output-review dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 24px;
  font-size: 13px;
}
.output-review dt,
.output-review p {
  color: var(--textSecondary);
}
.output-review dd {
  margin: 0;
  text-align: right;
}
.output-review p {
  margin-top: 24px;
  line-height: 1.8;
  font-size: 12px;
}
.editor-footer {
  min-height: 64px;
  padding: 0 24px;
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: var(--surfaceRaised);
}
.sql-table-reference {
  flex: 1;
  min-height: 150px;
  overflow: hidden;
}
.sql-field-reference {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.sql-field-reference header,
.sql-field-reference li > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sql-field-reference header strong,
.sql-field-reference li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sql-field-reference p {
  color: var(--textSecondary);
  font-size: 12px;
}
.sql-field-reference ul {
  flex: 1;
  min-height: 0;
  overflow: auto;
  list-style: none;
  padding: 0;
  margin: 0;
}
.sql-field-reference li {
  padding: 6px 0;
}
.sql-field-reference small {
  color: var(--textSecondary);
}
</style>
