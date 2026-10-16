<script setup lang="ts">
const canWrite = useCan('write')
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NButton, NCard, NInput, NSelect, NPagination, NAlert } from 'naive-ui'
import { Plus, Search, RefreshCw } from 'lucide-vue-next'
import { useSources, useDeleteSource, SourceListTable, connectorOptions } from '@/modules/sources'
import { useListRoute } from '@/shared/composables/use-list-route'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { errorKey } from '@/shared/api/error-message'
import { useCan } from '@/shared/security/permissions'
const { t } = useI18n()
const router = useRouter()
const { filters, update, bindPagination } = useListRoute()
const query = useSources(filters)
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
const remove = useDeleteSource()
const deleteId = ref('')
const readonly = computed(() => !canWrite.value)
function requestDelete(id: string) {
  deleteId.value = id
  remove.reset()
}
async function confirm() {
  if (remove.isPending.value) return
  try {
    await remove.mutateAsync(deleteId.value)
    deleteId.value = ''
  } catch {}
}
</script>
<template>
  <PageHeader :title="t('sources.title')" :description="t('sources.description')"
    ><NButton :disabled="readonly" type="primary" @click="router.push('/sources/new')"
      ><template #icon><Plus :size="16" /></template>{{ t('sources.new') }}</NButton
    ></PageHeader
  ><NCard :bordered="false"
    ><QueryToolbar
      ><NInput
        :value="filters.q"
        clearable
        :placeholder="t('search')"
        @update:value="update({ q: $event, page: 1 })"
        ><template #prefix><Search :size="16" /></template></NInput
      ><NSelect
        :value="filters.type || null"
        :placeholder="t('type')"
        clearable
        :options="connectorOptions"
        @update:value="update({ type: $event, page: 1 })" /><NSelect
        :value="filters.status || null"
        :placeholder="t('status')"
        clearable
        :options="['connected', 'warning', 'offline'].map((value) => ({ value, label: t(value) }))"
        @update:value="update({ status: $event, page: 1 })" /><NButton
        quaternary
        :aria-label="t('refresh')"
        @click="query.refetch()"
        ><RefreshCw :size="16" /></NButton></QueryToolbar
    ><NAlert v-if="query.error.value && query.data.value" type="error" class="mb">{{
      t(errorKey(query.error.value))
    }}</NAlert
    ><AsyncState
      :loading="query.isLoading.value"
      :error="query.data.value ? undefined : query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><SourceListTable
        :rows="query.data.value?.data ?? []"
        :readonly="readonly"
        @open="router.push('/sources/' + $event)"
        @edit="router.push('/sources/' + $event + '/edit')"
        @delete="requestDelete"
    /></AsyncState>
    <div class="pagination">
      <span>{{ t('total', { total: query.data.value?.meta.total ?? 0 }) }}</span
      ><NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        show-size-picker
        :page-sizes="[20, 50, 100]"
        @update:page="update({ page: $event })"
        @update:page-size="update({ pageSize: $event, page: 1 })"
      /></div></NCard
  ><ConfirmDialog
    :show="!!deleteId"
    :title="t('sources.deleteTitle')"
    :description="t('sources.deleteDescription')"
    :pending="remove.isPending.value"
    :error="remove.error.value ? t(errorKey(remove.error.value)) : undefined"
    @cancel="deleteId = ''"
    @confirm="confirm"
  />
</template>
