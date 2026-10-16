<script setup lang="ts">
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NInput,
  NAlert,
  NTabs,
  NTabPane,
  NDescriptions,
  NDescriptionsItem,
  NDataTable,
} from 'naive-ui'
import { useService, useServiceActions, useServiceAudit } from '@/modules/services'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { useCan } from '@/shared/security/permissions'
import { ApiError } from '@/shared/api/client'
import { errorKey } from '@/shared/api/error-message'
const route = useRoute(),
  router = useRouter(),
  id = computed(() => String(route.params.id)),
  query = useService(id),
  audit = useServiceAudit(id),
  actions = useServiceActions(),
  input = ref('{}'),
  error = ref('')
const tab = computed(() =>
  ['caller', 'audit'].includes(String(route.query.tab)) ? String(route.query.tab) : 'contract',
)
watch([id, input], () => {
  error.value = ''
  actions.call.reset()
})
async function call() {
  if (actions.call.isPending.value) return
  let parameters: Record<string, string>
  try {
    parameters = JSON.parse(input.value)
    if (
      typeof parameters !== 'object' ||
      Array.isArray(parameters) ||
      parameters === null ||
      Object.values(parameters).some((value) => typeof value !== 'string')
    )
      throw new Error()
  } catch {
    actions.call.reset()
    error.value = uiText('services.invalidJson')
    return
  }
  try {
    error.value = ''
    actions.call.reset()
    await actions.call.mutateAsync({ id: id.value, parameters })
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'INVALID_PARAMETER')
      error.value = uiText('services.invalidParameter')
    else if (cause instanceof ApiError && cause.code === 'SERVICE_DISABLED')
      error.value = uiText('services.disabled')
    else error.value = uiText(errorKey(cause))
  }
}
const contract = computed(() => ({
  method: 'POST',
  path: '/api/v1/services/' + id.value + '/call',
  parameters: query.data.value?.parameters,
  fields: query.data.value?.fields,
  pageSize: query.data.value?.pageSize,
}))
</script>
<template>
  <PageHeader
    :title="query.data.value?.name ?? uiText('ui.service_detail_02638059')"
    :description="uiText('ui.service_detail_40240bbb')"
    ><NButton @click="router.push('/services')">{{ uiText('ui.service_detail_4f9adefb') }}</NButton
    ><NButton
      type="primary"
      :disabled="!canWrite"
      @click="router.push('/services/' + id + '/edit')"
      >{{ uiText('ui.service_detail_5cdee473') }}</NButton
    ></PageHeader
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><NCard :bordered="false" class="mb"
      ><NDescriptions :column="3"
        ><NDescriptionsItem :label="uiText('ui.service_detail_62e951a6')">{{
          query.data.value?.enabled
            ? uiText('ui.service_detail_176a2eb4')
            : uiText('ui.service_detail_6c7dcbb7')
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.service_detail_61a9d8b4')">{{
          query.data.value?.callCount
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.service_detail_ae71b35e')"
          ><NButton
            text
            type="primary"
            @click="router.push('/warehouse/tables/' + query.data.value?.tableId)"
            >{{ query.data.value?.tableId }}</NButton
          ></NDescriptionsItem
        ></NDescriptions
      ></NCard
    ><NCard :bordered="false"
      ><NTabs
        type="line"
        :value="tab"
        @update:value="router.push({ query: { ...route.query, tab: $event } })"
        ><NTabPane name="contract" :tab="uiText('ui.service_detail_a7ac85f2')"
          ><CopyButton :value="JSON.stringify(contract, null, 2)" />
          <pre>{{ JSON.stringify(contract, null, 2) }}</pre></NTabPane
        ><NTabPane name="caller" :tab="uiText('ui.service_detail_099fe771')"
          ><NAlert type="info" class="mb">{{ uiText('ui.service_detail_d90547df') }}</NAlert
          ><NInput
            v-model:value="input"
            :input-props="{ 'aria-label': uiText('services.callInput') }"
            :disabled="actions.call.isPending.value"
            type="textarea"
            :rows="5"
            :placeholder="uiText('ui.service_detail_8af55443')" /><NButton
            type="primary"
            :loading="actions.call.isPending.value"
            style="margin: 16px 0"
            @click="call"
            >{{ uiText('ui.service_detail_d946b646') }}</NButton
          ><NAlert v-if="error" type="error" class="mb">{{ error }}</NAlert
          ><NDataTable
            :data="actions.call.data.value ?? []"
            :columns="query.data.value?.fields.map((key) => ({ title: key, key })) ?? []"
            :bordered="false" /></NTabPane
        ><NTabPane name="audit" :tab="uiText('auditLog')"
          ><AsyncState
            :loading="audit.isLoading.value"
            :error="audit.error.value"
            :empty="audit.data.value?.length === 0"
            @retry="audit.refetch()"
            ><NDataTable
              :data="audit.data.value ?? []"
              :columns="[
                { title: uiText('ui.audit_89b4aa63'), key: 'at' },
                { title: uiText('ui.audit_ffb50d38'), key: 'actor' },
                { title: uiText('ui.audit_c0939594'), key: 'action' },
                { title: uiText('description'), key: 'detail' },
              ]"
              :bordered="false" /></AsyncState></NTabPane></NTabs></NCard
  ></AsyncState>
</template>
<style scoped>
pre {
  background: var(--surface);
  padding: 24px;
  border-radius: 10px;
  overflow: auto;
}
</style>
