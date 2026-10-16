<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { NCard, NButton, NAlert } from 'naive-ui'
import { useService, useServiceActions, ServiceForm } from '@/modules/services'
import { useTables } from '@/modules/warehouse'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { errorKey } from '@/shared/api/error-message'
import { useCan } from '@/shared/security/permissions'
import type { Model } from '@/shared/api/types'
const route = useRoute(),
  router = useRouter(),
  id = computed(() => String(route.params.id ?? '')),
  query = useService(id),
  tables = useTables({ pageSize: '100' }),
  actions = useServiceActions()
const form = ref<InstanceType<typeof ServiceForm> | null>(null)
const canWrite = useCan('write')
const restricted = computed(() => query.data.value?.definitionRestricted === true)
const pending = computed(
  () => actions.save.isPending.value || actions.updateMetadata.isPending.value,
)
const saveError = computed(() => actions.save.error.value ?? actions.updateMetadata.error.value)
const draft = ref<Model<'ServiceInput'>>({
    name: '',
    description: '',
    owner: uiText('ui.service_editor_57175f8e'),
    tags: [],
    tableId: '',
    fields: [],
    parameters: [],
    pageSize: 20,
    sortField: '',
    allowedRoles: ['admin', 'developer', 'viewer'],
  }),
  baseline = ref(JSON.stringify(draft.value))
watch(
  () => query.data.value,
  (data) => {
    if (data && baseline.value === JSON.stringify(draft.value)) {
      draft.value = {
        name: data.name,
        description: data.description,
        owner: data.owner,
        tags: [...data.tags],
        tableId: data.tableId,
        fields: [...data.fields],
        parameters: data.parameters.map((parameter) => ({ ...parameter })),
        pageSize: data.pageSize,
        sortField: data.sortField,
        allowedRoles: [...data.allowedRoles],
      }
      baseline.value = JSON.stringify(draft.value)
    }
  },
  { immediate: true },
)
useEditGuard(() => baseline.value !== JSON.stringify(draft.value), pending)
async function refresh() {
  await Promise.all([query.refetch(), tables.refetch()])
}
async function save() {
  if (pending.value || !canWrite.value || (id.value && !query.data.value)) return
  actions.save.reset()
  actions.updateMetadata.reset()
  try {
    await form.value?.validate()
  } catch {
    return
  }
  try {
    const service = restricted.value
      ? await actions.updateMetadata.mutateAsync({
          id: id.value,
          body: {
            name: draft.value.name,
            description: draft.value.description,
            owner: draft.value.owner,
            tags: [...draft.value.tags],
            pageSize: draft.value.pageSize,
            allowedRoles: [...draft.value.allowedRoles],
          },
        })
      : await actions.save.mutateAsync({
          id: id.value || undefined,
          body: JSON.parse(JSON.stringify(draft.value)),
        })
    baseline.value = JSON.stringify(draft.value)
    await router.push('/services/' + service.id)
  } catch {}
}
</script>
<template>
  <PageHeader
    :title="id ? uiText('ui.service_editor_7f2a3157') : uiText('ui.service_editor_6d600202')"
    :description="uiText('ui.service_editor_849b3779')"
    ><NButton :disabled="pending" @click="router.back()">{{
      uiText('ui.service_editor_4d0b4688')
    }}</NButton
    ><NButton
      type="primary"
      :loading="pending"
      :disabled="
        !canWrite || (!!id && !query.data.value) || tables.isLoading.value || !!tables.error.value
      "
      @click="save"
      >{{ uiText('ui.service_editor_2d85ec15') }}</NButton
    ></PageHeader
  ><AsyncState
    :loading="(!!id && query.isLoading.value) || tables.isLoading.value"
    :error="query.error.value || tables.error.value"
    @retry="refresh"
    ><NCard class="form-card" :bordered="false"
      ><NAlert v-if="id" type="warning" class="mb">{{
        uiText('ui.service_editor_148c0f65')
      }}</NAlert
      ><NAlert v-if="restricted" type="warning" class="mb">{{
        uiText('services.restrictedDefinition')
      }}</NAlert
      ><NAlert v-if="saveError" type="error" class="mb">{{ uiText(errorKey(saveError)) }}</NAlert
      ><ServiceForm
        ref="form"
        v-model="draft"
        :tables="tables.data.value?.data ?? []"
        :definition-readonly="restricted"
        :disabled="pending || !canWrite" /></NCard
  ></AsyncState>
</template>
