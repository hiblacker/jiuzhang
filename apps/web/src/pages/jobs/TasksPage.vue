<script setup lang="ts">
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

const canWrite = useCan('write')
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NCard,
  NButton,
  NInput,
  NSelect,
  NDataTable,
  NTag,
  NSpace,
  NPagination,
  NAlert,
  type DataTableColumns,
} from 'naive-ui'
import { useTasks, useJobActions, RunTrigger } from '@/modules/jobs'
import { useDisplayTime } from '@/shared/composables/use-display-time'
const dateTime = useDisplayTime()
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { QueryToolbar } from '@/shared/ui/query-toolbar'
import { useListRoute } from '@/shared/composables/use-list-route'
import { useCan } from '@/shared/security/permissions'
import type { Model } from '@/shared/api/types'
const router = useRouter(),
  { filters, update, bindPagination } = useListRoute(),
  params = computed(() => ({
    q: filters.value.q,
    enabled: filters.value.status,
    page: String(filters.value.page),
    pageSize: String(filters.value.pageSize),
  })),
  query = useTasks(params),
  actions = useJobActions(),
  readonly = computed(() => !canWrite.value)
bindPagination(() =>
  query.isSuccess.value && !query.isFetching.value ? query.data.value?.meta : undefined,
)
async function toggle(task: Model<'Task'>) {
  try {
    await actions.toggle.mutateAsync({ id: task.id, enabled: !task.enabled })
  } catch {}
}
const columns = computed<DataTableColumns<Model<'Task'>>>(() => [
  {
    title: uiText('ui.tasks_3172b317'),
    key: 'name',
    minWidth: 220,
    render: (t) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => router.push('/tasks/' + t.id) },
        () => t.name,
      ),
  },
  {
    title: uiText('ui.tasks_62e951a6'),
    key: 'enabled',
    width: 100,
    render: (t) =>
      h(NTag, { size: 'small', bordered: false, type: t.enabled ? 'success' : 'default' }, () =>
        t.enabled ? uiText('ui.tasks_25d28431') : uiText('ui.tasks_fcbae46b'),
      ),
  },
  {
    title: uiText('ui.tasks_36019dc2'),
    key: 'schedule',
    minWidth: 160,
    render: (t) => {
      if (t.schedule.mode === 'cron') return t.schedule.cron
      if (t.schedule.mode === 'interval')
        return (
          uiText('ui.tasks_a3202533') + t.schedule.intervalMinutes + uiText('ui.tasks_5b0acd18')
        )
      return uiText('ui.tasks_2a4a4de8')
    },
  },
  {
    title: uiText('jobs.nextRun'),
    key: 'nextRun',
    minWidth: 180,
    render: (task) => {
      if (!task.enabled) return uiText('jobs.paused')
      if (task.schedule.mode === 'manual') return uiText('jobs.manual')
      if (!task.nextRunAt) return uiText('jobs.unsupported')
      return dateTime(task.nextRunAt)
    },
  },
  {
    title: uiText('ui.tasks_f3ea6d34'),
    key: 'actions',
    width: 400,
    render: (t) =>
      h(NSpace, { align: 'center' }, () => [
        h(
          NButton,
          {
            quaternary: true,
            size: 'small',
            disabled: readonly.value,
            onClick: () => router.push('/tasks/' + t.id + '/edit'),
          },
          () => uiText('ui.tasks_d7d7ce79'),
        ),
        h(
          NButton,
          {
            quaternary: true,
            size: 'small',
            disabled: readonly.value || actions.toggle.isPending.value,
            onClick: () => toggle(t),
          },
          () => (t.enabled ? uiText('ui.tasks_130448bc') : uiText('ui.tasks_79748ca1')),
        ),
        h(RunTrigger, {
          datasetId: t.datasetId,
          onStarted: (id: string) => router.push('/runs/' + id),
        }),
      ]),
  },
])
</script>
<template>
  <PageHeader :title="uiText('ui.tasks_f692ff9e')" :description="uiText('ui.tasks_2576f5c0')"
    ><NButton @click="router.push('/runs')">{{ uiText('ui.tasks_24fb424d') }}</NButton></PageHeader
  ><NAlert type="info" class="mb">{{ uiText('ui.tasks_74995557') }}</NAlert
  ><NCard :bordered="false"
    ><QueryToolbar
      ><NInput
        :value="filters.q"
        clearable
        :placeholder="uiText('ui.tasks_b8c6763d')"
        @update:value="update({ q: $event, page: 1 })" /><NSelect
        :value="filters.status || null"
        v-select-trigger-name="uiText('status')"
        clearable
        :placeholder="uiText('status')"
        :options="[
          { label: uiText('ui.tasks_25d28431'), value: 'true' },
          { label: uiText('jobs.paused'), value: 'false' },
        ]"
        @update:value="update({ status: $event ?? '', page: 1 })" /></QueryToolbar
    ><NAlert v-if="actions.toggle.error.value" type="error">{{
      uiText('ui.tasks_51d3cb57')
    }}</NAlert
    ><AsyncState
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty="query.data.value?.data.length === 0"
      @retry="query.refetch()"
      ><NDataTable
        :columns="columns"
        :data="query.data.value?.data ?? []"
        :bordered="false"
        :scroll-x="900"
    /></AsyncState>
    <div class="pagination">
      <span
        >{{ uiText('ui.tasks_3b6ef811') }}{{ query.data.value?.meta.total ?? 0
        }}{{ uiText('ui.tasks_bce2ef61') }}</span
      ><NPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :item-count="query.data.value?.meta.total ?? 0"
        @update:page="update({ page: $event })"
      /></div
  ></NCard>
</template>
