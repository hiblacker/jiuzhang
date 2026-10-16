<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
import { ref, h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NPagination,
  NCard,
  NButton,
  NInput,
  NSelect,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NAlert,
  NCheckbox,
  NUpload,
  NProgress,
  type DataTableColumns,
  type FormInst,
  type UploadFileInfo,
} from 'naive-ui'
import { useImports, useWarehouseActions } from '@/modules/warehouse'
import { PageHeader } from '@/shared/ui/page-header'
import { useListRoute } from '@/shared/composables/use-list-route'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { AsyncState } from '@/shared/ui/async-state'
import { CsvParseError, parseCsv } from '@/shared/lib/csv'
import { useCan } from '@/shared/security/permissions'
import type { Model } from '@/shared/api/types'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { ApiError } from '@/shared/api/client'
const router = useRouter(),
  { filters, update, bindPagination } = useListRoute(),
  query = useImports(() =>
    Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
  ),
  actions = useWarehouseActions(),
  open = ref(false),
  consent = ref(false),
  error = ref('')
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
const initialInput: Model<'ImportInput'> = {
  outcome: 'succeeded',
  name: uiText('ui.imports_97f97de4'),
  tableName: 'ods_demo_inventory',
  layer: 'ODS',
  subjectDomain: '',
  csv: ['id,product,stock', uiText('ui.imports_89a4f7ba'), uiText('ui.imports_19bcbce0')].join(
    String.fromCharCode(10),
  ),
  mapping: [],
}
const input = ref<Model<'ImportInput'>>(structuredClone(initialInput))
const form = ref<FormInst | null>(null)
const baseline = ref('')
const { canLeave } = useEditGuard(
  () => open.value && JSON.stringify(input.value) !== baseline.value,
  actions.import.isPending,
)
function close(show: boolean) {
  if (show || canLeave()) open.value = show
}
const rules = {
  name: { required: true, whitespace: true, message: uiText('required'), trigger: 'blur' },
  tableName: {
    required: true,
    pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/,
    message: uiText('errors.VALIDATION_ERROR'),
    trigger: 'blur',
  },
  csv: { required: true, whitespace: true, message: uiText('required'), trigger: 'blur' },
}
function progressStatus(status: Model<'Import'>['status']) {
  if (status === 'failed') return 'error'
  if (status === 'succeeded') return 'success'
  return 'default'
}
function mapFields() {
  try {
    if (new TextEncoder().encode(input.value.csv).byteLength > 1000000)
      throw new Error(uiText('ui.imports_9786f411'))
    const rows = parseCsv(input.value.csv)
    if (rows.length > 1001) throw new Error(uiText('warehouse.importRowLimit'))
    input.value.mapping = rows[0]!.map((source) => ({
      source,
      target: input.value.mapping.find((mapping) => mapping.source === source)?.target ?? source,
    }))
    error.value = ''
    return true
  } catch (e) {
    if (e instanceof CsvParseError) error.value = uiText('csv.errors.' + e.code)
    else error.value = e instanceof Error ? e.message : uiText('ui.imports_f0609cc4')
    return false
  }
}
async function fileChange({ file }: { file: UploadFileInfo }) {
  if (!file.file) return false
  if (!file.name.toLowerCase().endsWith('.csv')) {
    error.value = uiText('warehouse.importCsvOnly')
    return false
  }
  if (file.file.size > 1000000) {
    error.value = uiText('ui.imports_9786f411')
    return false
  }
  try {
    input.value.csv = await file.file.text()
    mapFields()
  } catch {
    error.value = uiText('warehouse.importReadFailed')
  }
  return false
}
async function submit() {
  if (actions.import.isPending.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (!consent.value) {
    error.value = uiText('ui.imports_d54f219e')
    return
  }
  if (!mapFields()) return
  const targets = input.value.mapping.map((mapping) => mapping.target.trim())
  if (targets.some((target) => !target) || new Set(targets).size !== targets.length) {
    error.value = uiText('warehouse.importMappingInvalid')
    return
  }
  input.value.mapping.forEach((mapping) => (mapping.target = mapping.target.trim()))
  try {
    await actions.import.mutateAsync(JSON.parse(JSON.stringify(input.value)))
    open.value = false
    consent.value = false
  } catch (e) {
    error.value =
      e instanceof ApiError && e.code === 'DUPLICATE_NAME'
        ? uiText('errors.DUPLICATE_NAME')
        : uiText('ui.imports_f0609cc4')
  }
}
const columns: DataTableColumns<Model<'Import'>> = [
  { title: uiText('ui.imports_c92a5d17'), key: 'name' },
  {
    title: uiText('ui.imports_62e951a6'),
    key: 'status',
    render: (r) =>
      ({
        queued: uiText('states.queued'),
        running: uiText('states.running'),
        succeeded: uiText('states.succeeded'),
        failed: uiText('states.failed'),
      })[r.status],
  },
  {
    title: uiText('warehouse.progress'),
    key: 'progress',
    width: 160,
    render: (r) =>
      h(NProgress, { type: 'line', percentage: r.progress, status: progressStatus(r.status) }),
  },
  { title: uiText('ui.imports_579f280b'), key: 'rowCount' },
  {
    title: uiText('ui.imports_442be9c4'),
    key: 'tableId',
    render: (r: Model<'Import'>) =>
      r.status !== 'succeeded' || !r.tableId
        ? uiText('warehouse.noPublishedTable')
        : h(
            NButton,
            {
              text: true,
              type: 'primary',
              onClick: () => router.push('/warehouse/tables/' + r.tableId),
            },
            () => r.tableId,
          ),
  },
  { title: uiText('ui.imports_89b4aa63'), key: 'createdAt' },
  { title: uiText('warehouse.failureReason'), key: 'error' },
]
function start() {
  input.value = structuredClone(initialInput)
  consent.value = false
  error.value = ''
  actions.import.reset()
  mapFields()
  baseline.value = JSON.stringify(input.value)
  open.value = true
}
</script>
<template>
  <PageHeader :title="uiText('ui.imports_c92a5d17')" :description="uiText('ui.imports_8fb2069a')"
    ><NButton type="primary" :disabled="!canWrite" @click="start">{{
      uiText('ui.imports_edd4b1ef')
    }}</NButton></PageHeader
  ><NCard :bordered="false"
    ><QueryToolbar>
      <NInput
        :value="filters.q"
        clearable
        :placeholder="uiText('warehouse.searchTransfers')"
        @update:value="update({ q: $event, page: 1 })"
      />
      <NSelect
        :value="filters.status || null"
        clearable
        :placeholder="uiText('status')"
        :aria-label="uiText('status')"
        :options="[
          { value: 'queued', label: uiText('states.queued') },
          { value: 'running', label: uiText('states.running') },
          { value: 'succeeded', label: uiText('states.succeeded') },
          { value: 'failed', label: uiText('states.failed') },
        ]"
        @update:value="update({ status: $event, page: 1 })"
      /> </QueryToolbar
    ><AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><NDataTable
        :data="query.data.value?.data ?? []"
        :columns="columns"
        :scroll-x="950"
        :bordered="false"
    /></AsyncState>
    <div class="pagination">
      <span>{{ uiText('total', { total: query.data.value?.meta.total ?? 0 }) }}</span>
      <NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        show-size-picker
        :page-sizes="[20, 50, 100]"
        @update:page="update({ page: $event })"
        @update:page-size="update({ pageSize: $event, page: 1 })"
      /></div></NCard
  ><NDrawer
    :show="open"
    width="min(620px, calc(100vw - 32px))"
    :mask-closable="!actions.import.isPending.value"
    :close-on-esc="!actions.import.isPending.value"
    @update:show="close"
    ><NDrawerContent
      :title="uiText('ui.imports_6c968a3f')"
      :closable="!actions.import.isPending.value"
      ><NAlert type="info" class="mb">{{ uiText('ui.imports_3ce513b9') }}</NAlert
      ><NForm
        ref="form"
        :model="input"
        :rules="rules"
        :disabled="actions.import.isPending.value"
        label-placement="top"
        ><NFormItem path="name" :label="uiText('ui.imports_2e304698')"
          ><NInput
            v-model:value="input.name"
            :input-props="{ 'aria-label': uiText('ui.imports_2e304698') }" /></NFormItem
        ><NFormItem path="tableName" :label="uiText('ui.imports_451035fe')"
          ><NInput
            v-model:value="input.tableName"
            :input-props="{ 'aria-label': uiText('ui.imports_451035fe') }" /></NFormItem
        ><NFormItem :label="uiText('ui.imports_2bee776c')"
          ><NSelect
            v-model:value="input.layer"
            :options="
              ['ODS', 'DWD', 'DWS', 'ADS'].map((value) => ({ value, label: value }))
            " /></NFormItem
        ><NFormItem :label="uiText('warehouse.subjectDomain')"
          ><NInput
            v-model:value="input.subjectDomain"
            :maxlength="60"
            :input-props="{ 'aria-label': uiText('warehouse.subjectDomain') }"
            :placeholder="uiText('warehouse.domainHint')" /></NFormItem
        ><NUpload
          :default-upload="false"
          :show-file-list="false"
          accept=".csv"
          :on-before-upload="fileChange"
          ><NButton>{{ uiText('ui.imports_2aa9d5d6') }}</NButton></NUpload
        ><NFormItem path="csv" :label="uiText('ui.imports_29125a75')"
          ><NInput
            v-model:value="input.csv"
            :input-props="{ 'aria-label': uiText('ui.imports_29125a75') }"
            type="textarea"
            :rows="7" /></NFormItem
        ><NButton @click="mapFields">{{ uiText('ui.imports_e89453b5') }}</NButton>
        <div v-for="mapping in input.mapping" :key="mapping.source" class="mapping">
          <span>{{ mapping.source }} →</span
          ><NInput
            v-model:value="mapping.target"
            :input-props="{
              'aria-label': uiText('warehouse.importMapping', { field: mapping.source }),
            }"
          />
        </div>
        <NFormItem :label="uiText('warehouse.scenario')"
          ><NSelect
            v-model:value="input.outcome"
            :options="[
              { label: uiText('warehouse.importSuccess'), value: 'succeeded' },
              { label: uiText('warehouse.importFailure'), value: 'failed' },
            ]"
        /></NFormItem>
        <NCheckbox v-model:checked="consent">{{ uiText('ui.imports_cd455dcd') }}</NCheckbox
        ><NAlert v-if="error" type="error" style="margin-top: 16px">{{ error }}</NAlert></NForm
      ><template #footer
        ><NButton type="primary" :loading="actions.import.isPending.value" @click="submit">{{
          uiText('ui.imports_f2a31c17')
        }}</NButton></template
      ></NDrawerContent
    ></NDrawer
  >
</template>
<style scoped>
.mapping {
  display: flex;
  gap: 14px;
  align-items: center;
  margin: 14px 0;
}
.mapping span {
  min-width: 100px;
}
</style>
