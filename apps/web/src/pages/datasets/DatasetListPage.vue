<script setup lang="ts">
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
import { computed, h, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NButton,
  NInput,
  NSelect,
  NDataTable,
  NTag,
  NEllipsis,
  NSpace,
  NPagination,
  type DataTableColumns,
} from 'naive-ui'
import { Plus, Layers } from 'lucide-vue-next'
import {
  useDatasets,
  useDatasetActions,
  useFolders,
  folderPath,
  DatasetFolderPanel,
  DatasetMoveDialog,
} from '@/modules/datasets'
import { RunTrigger } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { useListRoute } from '@/shared/composables/use-list-route'
import { useCan } from '@/shared/security/permissions'
import type { Model } from '@/shared/api/types'
const { t } = useI18n(),
  router = useRouter(),
  { filters, update, queryValue, bindPagination } = useListRoute(),
  actions = useDatasetActions()
const real = import.meta.env.VITE_API_MODE === 'real'
const folders = useFolders()
const moveDataset = ref<Model<'Dataset'> | null>(null)
const params = computed(() => ({
  ...Object.fromEntries(Object.entries(filters.value).map(([k, v]) => [k, String(v)])),
  folderId: queryValue('folderId'),
}))
const query = useDatasets(params),
  deleteId = ref(''),
  readonly = computed(() => !canWrite.value)
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
async function copy(id: string) {
  try {
    const d = await actions.copy.mutateAsync(id)
    await router.push('/datasets/' + d.id + '/edit')
  } catch {}
}
async function remove() {
  if (actions.remove.isPending.value) return
  try {
    await actions.remove.mutateAsync(deleteId.value)
    deleteId.value = ''
  } catch {}
}
const columns = computed<DataTableColumns<Model<'Dataset'>>>(() => [
  {
    title: uiText('ui.dataset_list_fc2b4735'),
    key: 'name',
    width: 260,
    render: (d) =>
      h(
        NButton,
        {
          text: true,
          type: 'primary',
          class: 'resource-name',
          title: d.name,
          onClick: () => router.push('/datasets/' + d.id),
        },
        {
          icon: () => h(Layers, { size: 18 }),
          default: () => h('span', { class: 'resource-name__text' }, d.name),
        },
      ),
  },
  {
    title: uiText('ui.dataset_list_62e951a6'),
    key: 'status',
    width: 110,
    render: (d) =>
      h(
        NTag,
        { size: 'small', bordered: false, type: d.status === 'published' ? 'success' : 'default' },
        () =>
          d.status === 'published'
            ? uiText('ui.dataset_list_176a2eb4')
            : uiText('ui.dataset_list_0f436818'),
      ),
  },
  {
    title: uiText('ui.dataset_list_c789c17a'),
    key: 'publishedVersion',
    width: 100,
    render: (d) => (d.publishedVersion ? 'v' + d.publishedVersion : '—'),
  },
  {
    title: uiText('ui.dataset_list_974d383f'),
    key: 'owner',
    width: 140,
    render: (dataset) =>
      h(
        NEllipsis,
        {
          tabindex: 0,
          tooltip: {
            trigger: 'focus',
            contentStyle: { maxWidth: 'min(480px, calc(100vw - 32px))', overflowWrap: 'anywhere' },
          },
        },
        {
          default: () => dataset.owner,
          tooltip: () => h('span', { role: 'tooltip' }, dataset.owner),
        },
      ),
  },
  {
    title: t('folders.folder'),
    key: 'folderId',
    width: 180,
    render: (d) => folderPath(folders.data.value ?? [], d.folderId) || t('folders.unfiled'),
  },
  {
    title: uiText('ui.dataset_list_f3ea6d34'),
    key: 'actions',
    width: 440,
    render: (d) =>
      h(NSpace, { align: 'center' }, () => [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            disabled: real || readonly.value,
            onClick: () => {
              moveDataset.value = d
            },
          },
          () => t('folders.move'),
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            disabled: readonly.value,
            onClick: () => router.push('/datasets/' + d.id + '/edit'),
          },
          () => t('edit'),
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            disabled: real || readonly.value || actions.copy.isPending.value,
            onClick: () => copy(d.id),
          },
          () => uiText('ui.dataset_list_4edd1d00'),
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'error',
            disabled: readonly.value,
            onClick: () => {
              deleteId.value = d.id
              actions.remove.reset()
            },
          },
          () => t('delete'),
        ),
        h(RunTrigger, {
          datasetId: d.id,
          disabled: !d.publishedVersion,
          onStarted: (id: string) => router.push('/runs/' + id),
        }),
      ]),
  },
])
</script>
<template>
  <PageHeader
    :title="uiText('ui.dataset_list_fc2b4735')"
    :description="uiText('ui.dataset_list_8da1cc5c')"
    ><NButton
      type="primary"
      :disabled="readonly"
      @click="
        router.push({
          path: '/datasets/new',
          query: params.folderId && params.folderId !== 'none' ? { folderId: params.folderId } : {},
        })
      "
      ><template #icon><Plus :size="16" /></template
      >{{ uiText('ui.dataset_list_e78bd5fa') }}</NButton
    ></PageHeader
  >
  <div class="dataset-layout" :class="{ 'dataset-layout--real': real }">
    <aside v-if="!real">
      <DatasetFolderPanel
        v-if="!real"
        :selected="params.folderId"
        @select="update({ folderId: $event, page: 1 })"
      />
    </aside>
    <NCard :bordered="false"
      ><QueryToolbar
        ><NInput
          :value="filters.q"
          clearable
          :placeholder="t('search')"
          @update:value="update({ q: $event, page: 1 })" /><NSelect
          :value="filters.status || null"
          v-select-trigger-name="uiText('ui.dataset_list_62e951a6')"
          clearable
          :placeholder="uiText('ui.dataset_list_62e951a6')"
          :options="[
            { label: uiText('ui.dataset_list_176a2eb4'), value: 'published' },
            { label: uiText('ui.dataset_list_0f436818'), value: 'draft' },
          ]"
          @update:value="update({ status: $event, page: 1 })" /><NSelect
          :value="filters.sort"
          v-select-trigger-name="uiText('sort')"
          :options="[
            { label: uiText('ui.dataset_list_5ebd027d'), value: 'updatedAt' },
            { label: uiText('ui.dataset_list_0ea96767'), value: 'name' },
          ]"
          @update:value="update({ sort: $event, page: 1 })" /></QueryToolbar
      ><AsyncState
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty="query.data.value?.data.length === 0"
        @retry="query.refetch()"
        ><NDataTable
          :columns="columns"
          :data="query.data.value?.data ?? []"
          :row-key="(d) => d.id"
          :scroll-x="1190"
          :bordered="false"
          table-layout="fixed"
      /></AsyncState>
      <div class="pagination">
        <span>{{ t('total', { total: query.data.value?.meta.total ?? 0 }) }}</span
        ><NPagination
          :page="filters.page"
          :page-size="filters.pageSize"
          :item-count="query.data.value?.meta.total ?? 0"
          @update:page="update({ page: $event })"
        /></div
    ></NCard>
  </div>
  <DatasetMoveDialog
    :dataset="moveDataset"
    @close="moveDataset = null"
    @moved="moveDataset = null"
  />
  <ConfirmDialog
    :show="!!deleteId"
    :title="uiText('ui.dataset_list_87510d58')"
    :description="uiText('ui.dataset_list_bbf432ef')"
    :pending="actions.remove.isPending.value"
    @confirm="remove"
    @cancel="deleteId = ''"
  />
</template>
<style scoped>
.dataset-layout {
  display: grid;
  grid-template-columns: 244px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.dataset-layout--real {
  grid-template-columns: minmax(0, 1fr);
}
.dataset-layout > * {
  min-width: 0;
}
@media (max-width: 1100px) {
  .dataset-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
