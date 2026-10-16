<script setup lang="ts">
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import type { FormInst, FormRules } from 'naive-ui'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
import { computed, h, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NInput,
  NSelect,
  NDataTable,
  NDrawer,
  NDrawerContent,
  NForm,
  NFormItem,
  NSwitch,
  NAlert,
  NDescriptions,
  NDescriptionsItem,
  NPagination,
} from 'naive-ui'
import { useQuality, useQualityDetail, useGovernanceActions } from '@/modules/governance'
import { useDatasets } from '@/modules/datasets'
import { useRuns } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { useCan } from '@/shared/security/permissions'
import { useListRoute } from '@/shared/composables/use-list-route'
import { errorKey } from '@/shared/api/error-message'
import type { Model } from '@/shared/api/types'
const route = useRoute(),
  router = useRouter(),
  id = computed(() => String(route.params.id ?? '')),
  { filters, update, bindPagination } = useListRoute(),
  list = useQuality(
    computed(() =>
      Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
    ),
  ),
  detail = useQualityDetail(id),
  datasets = useDatasets({ pageSize: '100' }),
  runs = useRuns({ pageSize: '100' }),
  actions = useGovernanceActions(),
  open = ref(false),
  editing = ref(''),
  readonly = computed(() => !canWrite.value)
bindPagination(() =>
  !id.value && list.isSuccess.value && !list.isFetching.value ? list.data.value?.meta : undefined,
)
const draft = ref<Model<'QualityInput'>>({
  name: '',
  description: '',
  owner: uiText('ui.quality_df724e0c'),
  tags: [uiText('ui.quality_82f51682')],
  kind: 'required',
  field: 'id',
  parameter: '',
  severity: 'BLOCK',
  enabled: true,
})
const current = computed(() => detail.data.value)
const form = ref<FormInst | null>(null)
const baseline = ref('')
const { canLeave } = useEditGuard(
  () => open.value && baseline.value !== JSON.stringify(draft.value),
  actions.saveQuality.isPending,
)
function close(show: boolean) {
  if (show || canLeave()) open.value = show
}
const rules: FormRules = {
  name: { required: true, whitespace: true, message: uiText('required'), trigger: 'blur' },
  field: { required: true, whitespace: true, message: uiText('required'), trigger: 'blur' },
}
function edit(value?: Model<'Quality'>) {
  actions.saveQuality.reset()
  editing.value = value?.id ?? ''
  draft.value = value
    ? {
        name: value.name,
        description: value.description,
        owner: value.owner,
        tags: [...value.tags],
        kind: value.kind,
        field: value.field,
        parameter: value.parameter,
        severity: value.severity,
        enabled: value.enabled,
      }
    : {
        name: '',
        description: '',
        owner: uiText('ui.quality_df724e0c'),
        tags: [uiText('ui.quality_82f51682')],
        kind: 'required',
        field: 'id',
        parameter: '',
        severity: 'BLOCK',
        enabled: true,
      }
  baseline.value = JSON.stringify(draft.value)
  open.value = true
}
async function save() {
  if (actions.saveQuality.isPending.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  try {
    await actions.saveQuality.mutateAsync({
      id: editing.value || undefined,
      body: JSON.parse(JSON.stringify(draft.value)),
    })
    open.value = false
    actions.evaluate.reset()
  } catch {}
}
async function evaluate(scenario: 'pass' | 'warn' | 'block') {
  if (actions.evaluate.isPending.value) return
  actions.evaluate.reset()
  try {
    await actions.evaluate.mutateAsync({ id: id.value, scenario })
  } catch {}
}
const columns = [
  {
    title: uiText('ui.quality_1937bcb1'),
    key: 'name',
    render: (r: Model<'Quality'>) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => router.push('/governance/quality/' + r.id) },
        () => r.name,
      ),
  },
  { title: uiText('ui.quality_e4e46c72'), key: 'kind' },
  { title: uiText('ui.quality_77a49f2c'), key: 'field' },
  { title: uiText('ui.quality_e27bc7a5'), key: 'severity' },
  {
    title: uiText('ui.quality_62e951a6'),
    key: 'enabled',
    render: (r: Model<'Quality'>) =>
      r.enabled ? uiText('ui.quality_d4e9ca3d') : uiText('ui.quality_d989e551'),
  },
  { title: uiText('ui.quality_989d1aff'), key: 'version' },
  {
    title: uiText('ui.quality_f3ea6d34'),
    key: 'action',
    render: (r: Model<'Quality'>) =>
      h(NButton, { size: 'small', disabled: readonly.value, onClick: () => edit(r) }, () =>
        uiText('ui.quality_a7f814c0'),
      ),
  },
]
</script>
<template>
  <PageHeader
    :title="id ? (current?.name ?? uiText('ui.quality_a9f00e88')) : uiText('ui.quality_e974beee')"
    :description="uiText('ui.quality_c4dfb475')"
    ><NButton @click="router.push('/governance/catalog')">{{
      uiText('ui.quality_3c41d918')
    }}</NButton
    ><NButton
      type="primary"
      :disabled="readonly || (!!id && !current)"
      @click="edit(id ? current : undefined)"
      >{{ id ? uiText('ui.quality_13794d21') : uiText('ui.quality_eae3b2e9') }}</NButton
    ></PageHeader
  ><NCard :bordered="false"
    ><template v-if="!id"
      ><NInput
        :value="filters.q"
        @update:value="update({ q: $event, page: 1 })"
        :placeholder="uiText('ui.quality_ba7bfb82')"
        clearable
        style="max-width: 320px; margin-bottom: 24px" /><AsyncState
        :loading="list.isLoading.value"
        :error="list.error.value"
        :empty="list.data.value?.meta.total === 0"
        @retry="list.refetch()"
        ><NDataTable
          :columns="columns"
          :data="list.data.value?.data ?? []"
          :scroll-x="720"
          :bordered="false"
      /></AsyncState>
      <div class="pagination">
        <NPagination
          :page="filters.page"
          :page-size="filters.pageSize"
          :item-count="list.data.value?.meta.total ?? 0"
          @update:page="update({ page: $event })"
        /></div></template
    ><AsyncState
      v-else
      :loading="detail.isLoading.value"
      :error="detail.error.value"
      @retry="detail.refetch()"
      ><NDescriptions :column="3" bordered
        ><NDescriptionsItem :label="uiText('ui.quality_e4e46c72')">{{
          current?.kind
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.quality_77a49f2c')">{{
          current?.field
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.quality_989d1aff')"
          >v{{ current?.version }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.quality_749d7652')">{{
          current?.parameter || '—'
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.quality_e27bc7a5')">{{
          current?.severity
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.quality_62e951a6')">{{
          current?.enabled ? uiText('ui.quality_d4e9ca3d') : uiText('ui.quality_d989e551')
        }}</NDescriptionsItem></NDescriptions
      >
      <h3>{{ uiText('ui.quality_06b0cc31') }}</h3>
      <NAlert type="info" class="mb">{{ uiText('datasets.sampleHint') }}</NAlert>
      <div class="query-toolbar">
        <NButton
          v-for="scenario in ['pass', 'warn', 'block'] as const"
          :key="scenario"
          :loading="actions.evaluate.isPending.value"
          @click="evaluate(scenario)"
          >{{ scenario.toUpperCase() }}</NButton
        >
      </div>
      <NAlert v-if="actions.evaluate.error.value" type="error" class="mb">{{
        uiText(errorKey(actions.evaluate.error.value))
      }}</NAlert>
      <NAlert
        v-if="actions.evaluate.data.value"
        :type="actions.evaluate.data.value.result === 'PASS' ? 'success' : 'warning'"
        >{{ actions.evaluate.data.value.result }} ·
        {{ actions.evaluate.data.value.message }}</NAlert
      >
      <template v-if="actions.evaluate.data.value">
        <NDescriptions :column="3" bordered class="mb">
          <NDescriptionsItem :label="uiText('datasets.sampleCount')">{{
            actions.evaluate.data.value.total
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="uiText('datasets.failureCount')">{{
            actions.evaluate.data.value.failed
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="uiText('datasets.passRate')"
            >{{ actions.evaluate.data.value.passRate.toFixed(1) }}%</NDescriptionsItem
          >
        </NDescriptions>
        <NDataTable
          :data="actions.evaluate.data.value.rows"
          :columns="[{ title: current?.field ?? '', key: current?.field ?? '' }]"
          :bordered="false"
        />
      </template>
      <h3>{{ uiText('ui.quality_1d27e3e2') }}</h3>
      <NButton
        v-for="d in datasets.data.value?.data.filter((d) =>
          d.definition.qualityRuleIds.includes(id),
        )"
        :key="d.id"
        text
        type="primary"
        style="margin-right: 20px"
        @click="router.push('/datasets/' + d.id)"
        >{{ d.name }}</NButton
      >
      <h3>{{ uiText('ui.quality_40ab203b') }}</h3>
      <NDataTable
        :data="
          runs.data.value?.data.flatMap((r) =>
            r.qualityResults.filter((q) => q.ruleId === id).map((q) => ({ ...q, runId: r.id })),
          ) ?? []
        "
        :columns="[
          { title: uiText('ui.quality_0c3acd44'), key: 'runId' },
          { title: uiText('ui.quality_0700f94d'), key: 'version' },
          { title: uiText('ui.quality_0a2c91ce'), key: 'result' },
          { title: uiText('ui.quality_26670dda'), key: 'message' },
        ]"
        :bordered="false" /></AsyncState></NCard
  ><NDrawer
    :show="open"
    :width="480"
    :mask-closable="!actions.saveQuality.isPending.value"
    :close-on-esc="!actions.saveQuality.isPending.value"
    @update:show="close"
    ><NDrawerContent
      :title="uiText('ui.quality_e974beee')"
      :closable="!actions.saveQuality.isPending.value"
      ><NForm
        ref="form"
        :model="draft"
        :rules="rules"
        :disabled="actions.saveQuality.isPending.value"
        label-placement="top"
        ><NFormItem path="name" :label="uiText('ui.quality_1937bcb1')"
          ><NInput
            v-model:value="draft.name"
            :input-props="{ 'aria-label': uiText('ui.quality_1937bcb1') }" /></NFormItem
        ><NFormItem :label="uiText('ui.quality_e4e46c72')"
          ><NSelect
            v-model:value="draft.kind"
            :aria-label="uiText('ui.quality_e4e46c72')"
            :options="[
              { label: uiText('ui.quality_32945d3e'), value: 'required' },
              { label: uiText('ui.quality_e805014a'), value: 'unique' },
              { label: uiText('ui.quality_785b52eb'), value: 'range' },
              { label: uiText('ui.quality_d7f83126'), value: 'enum' },
              { label: uiText('ui.quality_17bb0cbf'), value: 'freshness' },
            ]" /></NFormItem
        ><NFormItem path="field" :label="uiText('ui.quality_77a49f2c')"
          ><NInput
            v-model:value="draft.field"
            :input-props="{ 'aria-label': uiText('ui.quality_77a49f2c') }" /></NFormItem
        ><NFormItem :label="uiText('ui.quality_749d7652')"
          ><NInput
            v-model:value="draft.parameter"
            :input-props="{ 'aria-label': uiText('ui.quality_749d7652') }"
            :placeholder="uiText('ui.quality_98b939e6')" /></NFormItem
        ><NFormItem :label="uiText('ui.quality_e27bc7a5')"
          ><NSelect
            v-model:value="draft.severity"
            :aria-label="uiText('ui.quality_e27bc7a5')"
            :options="[
              { label: uiText('ui.quality_d30e49d2'), value: 'WARN' },
              { label: uiText('ui.quality_40da8357'), value: 'BLOCK' },
            ]" /></NFormItem
        ><NFormItem :label="uiText('ui.quality_d4e9ca3d')"
          ><NSwitch
            v-model:value="draft.enabled"
            :aria-label="uiText('ui.quality_d4e9ca3d')" /></NFormItem
        ><NAlert v-if="actions.saveQuality.error.value" type="error">{{
          uiText(errorKey(actions.saveQuality.error.value))
        }}</NAlert></NForm
      ><template #footer
        ><NButton type="primary" :loading="actions.saveQuality.isPending.value" @click="save">{{
          uiText('ui.quality_f5d41261')
        }}</NButton></template
      ></NDrawerContent
    ></NDrawer
  >
</template>
