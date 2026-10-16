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
import {
  useMasking,
  useMaskDetail,
  useMaskPreview,
  useGovernanceActions,
} from '@/modules/governance'
import { useDatasets } from '@/modules/datasets'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { useCan } from '@/shared/security/permissions'
import { useListRoute } from '@/shared/composables/use-list-route'
import type { Model } from '@/shared/api/types'
const route = useRoute(),
  router = useRouter(),
  id = computed(() => String(route.params.id ?? '')),
  { filters, update, bindPagination } = useListRoute(),
  list = useMasking(
    computed(() =>
      Object.fromEntries(Object.entries(filters.value).map(([key, value]) => [key, String(value)])),
    ),
  ),
  detail = useMaskDetail(id),
  datasets = useDatasets({ pageSize: '100' }),
  actions = useGovernanceActions(),
  open = ref(false),
  editing = ref(''),
  readonly = computed(() => !canWrite.value)
bindPagination(() =>
  !id.value && list.isSuccess.value && !list.isFetching.value ? list.data.value?.meta : undefined,
)
const draft = ref<Model<'MaskingInput'>>({
  name: '',
  description: '',
  owner: uiText('ui.masking_df724e0c'),
  tags: [uiText('ui.masking_9e5bb043')],
  kind: 'mask',
  parameter: '3,4',
  enabled: true,
})
const form = ref<FormInst | null>(null)
const sampleType = ref<'phone' | 'email' | 'text' | 'amount'>('phone')
const sampleQuery = useMaskPreview(id, sampleType)
const baseline = ref('')
const { canLeave } = useEditGuard(
  () => open.value && baseline.value !== JSON.stringify(draft.value),
  actions.saveMask.isPending,
)
function close(show: boolean) {
  if (show || canLeave()) open.value = show
}
const rules: FormRules = {
  name: { required: true, whitespace: true, message: uiText('required'), trigger: 'blur' },
  parameter: {
    trigger: ['input', 'blur'],
    validator: () => {
      if (
        draft.value.kind === 'mask' &&
        !/^[0-9]{1,3},[0-9]{1,3}$/.test(draft.value.parameter.trim())
      )
        return new Error(uiText('masking.invalidMask'))
      if (
        draft.value.kind === 'generalize' &&
        (!draft.value.parameter.trim() || draft.value.parameter.length > 120)
      )
        return new Error(uiText('masking.invalidGeneralize'))
      return true
    },
  },
}
function edit(value?: Model<'Masking'>) {
  actions.saveMask.reset()
  editing.value = value?.id ?? ''
  draft.value = value
    ? {
        name: value.name,
        description: value.description,
        owner: value.owner,
        tags: [...value.tags],
        kind: value.kind,
        parameter: value.parameter,
        enabled: value.enabled,
      }
    : {
        name: '',
        description: '',
        owner: uiText('ui.masking_df724e0c'),
        tags: [uiText('ui.masking_9e5bb043')],
        kind: 'mask',
        parameter: '3,4',
        enabled: true,
      }
  baseline.value = JSON.stringify(draft.value)
  open.value = true
}
async function save() {
  if (actions.saveMask.isPending.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  try {
    await actions.saveMask.mutateAsync({
      id: editing.value || undefined,
      body: JSON.parse(JSON.stringify(draft.value)),
    })
    open.value = false
  } catch {}
}
const sample = computed(() => {
  const value = sampleQuery.data.value
  return value
    ? [
        {
          original: value.original,
          masked: value.removed ? uiText('ui.masking_64f38422') : value.masked,
        },
      ]
    : []
})
const columns = [
  {
    title: uiText('ui.masking_235f7a86'),
    key: 'name',
    render: (p: Model<'Masking'>) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => router.push('/governance/masking/' + p.id) },
        () => p.name,
      ),
  },
  { title: uiText('ui.masking_af908096'), key: 'kind' },
  { title: uiText('ui.masking_749d7652'), key: 'parameter' },
  { title: uiText('ui.masking_989d1aff'), key: 'version' },
  {
    title: uiText('ui.masking_62e951a6'),
    key: 'enabled',
    render: (p: Model<'Masking'>) =>
      p.enabled ? uiText('ui.masking_d4e9ca3d') : uiText('ui.masking_d989e551'),
  },
  {
    title: uiText('ui.masking_f3ea6d34'),
    key: 'action',
    render: (p: Model<'Masking'>) =>
      h(NButton, { size: 'small', disabled: readonly.value, onClick: () => edit(p) }, () =>
        uiText('ui.masking_a7f814c0'),
      ),
  },
]
</script>
<template>
  <PageHeader
    :title="
      id
        ? (detail.data.value?.name ?? uiText('ui.masking_acaffa69'))
        : uiText('ui.masking_0549993d')
    "
    :description="uiText('ui.masking_5cca49c7')"
    ><NButton @click="router.push('/governance/catalog')">{{
      uiText('ui.masking_3c41d918')
    }}</NButton
    ><NButton
      type="primary"
      :disabled="readonly || (!!id && !detail.data.value)"
      @click="edit(id ? detail.data.value : undefined)"
      >{{ id ? uiText('ui.masking_7c9a142f') : uiText('ui.masking_e42e8184') }}</NButton
    ></PageHeader
  ><NAlert type="info" class="mb">{{ uiText('ui.masking_4d65dd29') }}</NAlert
  ><NCard :bordered="false"
    ><template v-if="!id"
      ><NInput
        :value="filters.q"
        @update:value="update({ q: $event, page: 1 })"
        :placeholder="uiText('ui.masking_36eadf6e')"
        clearable
        style="max-width: 320px; margin-bottom: 24px" /><AsyncState
        :loading="list.isLoading.value"
        :error="list.error.value"
        :empty="list.data.value?.meta.total === 0"
        @retry="list.refetch()"
        ><NDataTable
          :data="list.data.value?.data ?? []"
          :columns="columns"
          :scroll-x="680"
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
        ><NDescriptionsItem :label="uiText('ui.masking_af908096')">{{
          detail.data.value?.kind
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.masking_989d1aff')"
          >v{{ detail.data.value?.version }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.masking_62e951a6')">{{
          detail.data.value?.enabled ? uiText('ui.masking_d4e9ca3d') : uiText('ui.masking_d989e551')
        }}</NDescriptionsItem></NDescriptions
      >
      <h3>{{ uiText('ui.masking_0bc9366d') }}</h3>
      <NSelect
        v-model:value="sampleType"
        :aria-label="uiText('masking.sample')"
        :options="[
          { label: uiText('masking.phone'), value: 'phone' },
          { label: uiText('masking.email'), value: 'email' },
          { label: uiText('masking.text'), value: 'text' },
          { label: uiText('masking.amount'), value: 'amount' },
        ]"
        class="mb"
      />
      <NAlert
        v-if="sampleQuery.data.value && !sampleQuery.data.value.enabled"
        type="warning"
        class="mb"
        >{{ uiText('masking.disabled') }}</NAlert
      >
      <AsyncState
        :loading="sampleQuery.isLoading.value"
        :error="sampleQuery.error.value"
        @retry="sampleQuery.refetch()"
      >
        <NDataTable
          :data="sample"
          :columns="[
            { title: uiText('ui.masking_d4f3e54a'), key: 'original' },
            { title: uiText('ui.masking_9a5ff083'), key: 'masked' },
          ]"
          :bordered="false"
        />
      </AsyncState>
      <h3>{{ uiText('ui.masking_f0225b54') }}</h3>
      <NButton
        v-for="d in datasets.data.value?.data.filter(
          (d) =>
            d.definition.maskPolicyIds.includes(id) ||
            d.definition.fields.some((f) => f.maskPolicyId === id),
        )"
        :key="d.id"
        text
        type="primary"
        style="margin-right: 20px"
        @click="router.push('/datasets/' + d.id)"
        >{{ d.name }}</NButton
      ></AsyncState
    ></NCard
  ><NDrawer
    :show="open"
    :width="480"
    :mask-closable="!actions.saveMask.isPending.value"
    :close-on-esc="!actions.saveMask.isPending.value"
    @update:show="close"
    ><NDrawerContent
      :title="uiText('ui.masking_0549993d')"
      :closable="!actions.saveMask.isPending.value"
      ><NForm
        ref="form"
        :model="draft"
        :rules="rules"
        :disabled="actions.saveMask.isPending.value"
        label-placement="top"
        ><NFormItem path="name" :label="uiText('ui.masking_235f7a86')"
          ><NInput
            v-model:value="draft.name"
            :input-props="{ 'aria-label': uiText('ui.masking_235f7a86') }" /></NFormItem
        ><NFormItem :label="uiText('ui.masking_af908096')"
          ><NSelect
            v-model:value="draft.kind"
            :aria-label="uiText('ui.masking_af908096')"
            :options="[
              { label: uiText('ui.masking_32866382'), value: 'mask' },
              { label: uiText('ui.masking_0ccc9cb0'), value: 'remove' },
              { label: uiText('ui.masking_0a09cd89'), value: 'generalize' },
            ]" /></NFormItem
        ><NFormItem path="parameter" :label="uiText('ui.masking_749d7652')"
          ><NInput
            v-model:value="draft.parameter"
            :disabled="draft.kind === 'remove'"
            :input-props="{ 'aria-label': uiText('ui.masking_749d7652') }"
            :placeholder="uiText('ui.masking_ebe19450')" /></NFormItem
        ><NFormItem :label="uiText('ui.masking_d4e9ca3d')"
          ><NSwitch
            v-model:value="draft.enabled"
            :aria-label="uiText('ui.masking_d4e9ca3d')" /></NFormItem
        ><NAlert v-if="actions.saveMask.error.value" type="error">{{
          uiText('ui.masking_2599b9ba')
        }}</NAlert></NForm
      ><template #footer
        ><NButton type="primary" :loading="actions.saveMask.isPending.value" @click="save">{{
          uiText('ui.masking_d824c490')
        }}</NButton></template
      ></NDrawerContent
    ></NDrawer
  >
</template>
