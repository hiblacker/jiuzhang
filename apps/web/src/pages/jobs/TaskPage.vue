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
  NForm,
  NFormItem,
  NDescriptions,
  NDescriptionsItem,
  NAlert,
  NModal,
  NDatePicker,
  type FormInst,
} from 'naive-ui'
import { useTask, useTasks, useRuns, useJobActions, ScheduleForm, RunTrigger } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import type { Model } from '@/shared/api/types'
import { useCan } from '@/shared/security/permissions'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { ApiError } from '@/shared/api/client'
import { useDisplayTime } from '@/shared/composables/use-display-time'
const route = useRoute(),
  router = useRouter(),
  id = computed(() => String(route.params.id)),
  editing = computed(() => route.path.endsWith('/edit')),
  query = useTask(id),
  tasks = useTasks({ pageSize: '100' }),
  runs = useRuns(() => ({ taskId: id.value, pageSize: '100' })),
  actions = useJobActions(),
  draft = ref<Model<'TaskInput'> | null>(null),
  baseline = ref(''),
  backfillOpen = ref(false),
  range = ref<[string, string] | null>(null),
  readonly = computed(() => !canWrite.value)
const dateTime = useDisplayTime()
const form = ref<FormInst | null>(null)
const dirty = computed(() => editing.value && JSON.stringify(draft.value) !== baseline.value)
let loadedId = ''
watch(
  [() => query.data.value, editing],
  ([data]) => {
    if (data && (loadedId !== data.id || !dirty.value)) {
      draft.value = {
        name: data.name,
        description: data.description,
        owner: data.owner,
        tags: [...data.tags],
        schedule: { ...data.schedule, dependencies: [...data.schedule.dependencies] },
      }
      baseline.value = JSON.stringify(draft.value)
      loadedId = data.id
    }
  },
  { immediate: true },
)
useEditGuard(dirty, () => actions.save.isPending.value || actions.backfill.isPending.value)
async function save() {
  if (!draft.value || actions.save.isPending.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  try {
    await actions.save.mutateAsync({ id: id.value, input: JSON.parse(JSON.stringify(draft.value)) })
    baseline.value = JSON.stringify(draft.value)
    await router.push('/tasks/' + id.value)
  } catch {}
}
async function backfill() {
  if (!range.value || actions.backfill.isPending.value) return
  try {
    await actions.backfill.mutateAsync({
      id: id.value,
      input: {
        from: range.value[0],
        to: range.value[1],
        outcome: 'succeeded',
      },
    })
    backfillOpen.value = false
    await router.push('/runs?trigger=backfill&taskId=' + id.value)
  } catch {}
}
</script>
<template>
  <PageHeader
    :title="query.data.value?.name ?? uiText('ui.task_9323d0aa')"
    :description="uiText('ui.task_7adc09b3')"
    ><NButton @click="router.push('/tasks')">{{ uiText('ui.task_f692ff9e') }}</NButton
    ><template v-if="editing"
      ><NButton :loading="actions.save.isPending.value" type="primary" @click="save">{{
        uiText('ui.task_817af187')
      }}</NButton></template
    ><template v-else
      ><NButton :disabled="readonly" @click="router.push('/tasks/' + id + '/edit')">{{
        uiText('ui.task_bb810789')
      }}</NButton
      ><NButton :disabled="readonly" @click="backfillOpen = true">{{
        uiText('ui.task_fe838448')
      }}</NButton
      ><RunTrigger
        v-if="query.data.value"
        :dataset-id="query.data.value.datasetId"
        @started="router.push('/runs/' + $event)" /></template></PageHeader
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><NCard :bordered="false"
      ><NAlert v-if="actions.save.error.value" type="error" class="mb">{{
        actions.save.error.value instanceof ApiError && actions.save.error.value.details.length
          ? actions.save.error.value.details.join('；')
          : uiText('ui.task_71670358')
      }}</NAlert
      ><NAlert v-if="!editing" type="info" class="mb">{{ uiText('ui.task_scheduleNote') }}</NAlert
      ><NForm
        v-if="editing && draft"
        ref="form"
        :model="draft"
        :rules="{
          name: {
            required: true,
            whitespace: true,
            message: uiText('required'),
            trigger: 'blur',
          },
        }"
        :disabled="actions.save.isPending.value"
        label-placement="top"
        ><NFormItem path="name" :label="uiText('ui.task_2e304698')"
          ><NInput
            v-model:value="draft.name"
            :input-props="{ 'aria-label': uiText('ui.task_2e304698') }" /></NFormItem
        ><ScheduleForm
          v-model="draft.schedule"
          :readonly="actions.save.isPending.value"
          :tasks="
            tasks.data.value?.data
              .filter((t) => t.id !== id)
              .map((t) => ({ label: t.name, value: t.id }))
          " /></NForm
      ><template v-else
        ><NDescriptions :column="2" bordered
          ><NDescriptionsItem :label="uiText('ui.task_fc2b4735')">{{
            query.data.value?.datasetId
          }}</NDescriptionsItem
          ><NDescriptionsItem :label="uiText('ui.task_62e951a6')">{{
            query.data.value?.enabled ? uiText('ui.task_d4e9ca3d') : uiText('ui.task_130448bc')
          }}</NDescriptionsItem
          ><NDescriptionsItem :label="uiText('ui.task_36019dc2')"
            >{{ query.data.value?.schedule.mode }} ·
            {{ query.data.value?.schedule.cron }}</NDescriptionsItem
          ><NDescriptionsItem :label="uiText('ui.task_fb2a23dc')">{{
            query.data.value?.schedule.timezone
          }}</NDescriptionsItem
          ><NDescriptionsItem :label="uiText('ui.task_885c619f')"
            ><NButton
              v-for="dep in query.data.value?.schedule.dependencies"
              :key="dep"
              text
              @click="router.push('/tasks/' + dep)"
              >{{ dep }}</NButton
            ></NDescriptionsItem
          ><NDescriptionsItem :label="uiText('ui.task_aff3a531')"
            >{{ query.data.value?.schedule.timeoutSeconds }}s /
            {{ query.data.value?.schedule.retries }}</NDescriptionsItem
          ><NDescriptionsItem :label="uiText('jobs.lastSuccess')"
            ><NButton
              v-if="query.data.value?.lastSuccessRunId"
              text
              type="primary"
              @click="router.push('/runs/' + query.data.value.lastSuccessRunId)"
              >{{ query.data.value.lastSuccessRunId }} ·
              {{ query.data.value.lastSuccessAt }}</NButton
            ><span v-else>—</span></NDescriptionsItem
          ><NDescriptionsItem :label="uiText('jobs.sla')"
            >{{ query.data.value?.schedule.timeoutSeconds }}s</NDescriptionsItem
          ><NDescriptionsItem :label="uiText('jobs.nextRun')"
            ><span v-if="query.data.value?.nextRunAt">{{
              dateTime(query.data.value.nextRunAt)
            }}</span
            ><span v-else>{{
              !query.data.value?.enabled
                ? uiText('jobs.paused')
                : query.data.value?.schedule.mode === 'manual'
                  ? uiText('jobs.manual')
                  : uiText('jobs.unsupported')
            }}</span></NDescriptionsItem
          ></NDescriptions
        >
        <h3>{{ uiText('ui.task_a961a1c4') }}</h3>
        <div
          v-for="run in runs.data.value?.data.filter((r) => r.taskId === id)"
          :key="run.id"
          class="task-run"
        >
          <NButton text type="primary" @click="router.push('/runs/' + run.id)">{{ run.id }}</NButton
          ><span>{{ run.status }} · {{ run.startedAt }}</span>
        </div></template
      ></NCard
    ></AsyncState
  ><NModal
    :show="backfillOpen"
    preset="card"
    :title="uiText('ui.task_22ed2e4e')"
    style="width: min(480px, calc(100vw - 32px))"
    :mask-closable="!actions.backfill.isPending.value"
    :close-on-esc="!actions.backfill.isPending.value"
    :closable="!actions.backfill.isPending.value"
    @close="!actions.backfill.isPending.value && (backfillOpen = false)"
    @update:show="!actions.backfill.isPending.value && (backfillOpen = $event)"
    ><NAlert type="info" class="mb">{{ uiText('ui.task_2f297c08') }}</NAlert
    ><NDatePicker
      v-model:formatted-value="range"
      value-format="yyyy-MM-dd"
      type="daterange"
      :start-placeholder="uiText('jobs.backfillFrom')"
      :end-placeholder="uiText('jobs.backfillTo')"
    /><NAlert v-if="actions.backfill.error.value" type="error">{{
      uiText('ui.task_f1fb8585')
    }}</NAlert
    ><template #footer
      ><NButton
        type="primary"
        :disabled="!range"
        :loading="actions.backfill.isPending.value"
        @click="backfill"
        >{{ uiText('ui.task_22eaf72b') }}</NButton
      ></template
    ></NModal
  >
</template>
<style scoped>
.task-run {
  display: flex;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
</style>
