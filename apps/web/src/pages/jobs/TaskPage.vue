<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n as useUiI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NForm,
  NFormItem,
  NInput,
  type FormInst,
} from 'naive-ui'
import { useTask, useJobActions, ScheduleForm, RunTrigger, RunHistory } from '@/modules/jobs'
import type { Model } from '@/shared/api/types'
import { useDisplayTime } from '@/shared/composables/use-display-time'
import { useEditGuard } from '@/shared/composables/use-edit-guard'
import { AsyncState } from '@/shared/ui/async-state'
import { PageHeader } from '@/shared/ui/page-header'
import { useCan } from '@/shared/security/permissions'

const { t: uiText } = useUiI18n()
const route = useRoute()
const router = useRouter()
const canWrite = useCan('write')
const id = computed(() => String(route.params.id))
const editing = computed(() => route.path.endsWith('/edit'))
const readonly = computed(() => !canWrite.value)
const query = useTask(id)
const actions = useJobActions()
const draft = ref<Model<'TaskInput'> | null>(null)
const baseline = ref('')
const form = ref<FormInst | null>(null)
const dateTime = useDisplayTime()
const dirty = computed(() => editing.value && JSON.stringify(draft.value) !== baseline.value)
const scheduleSummary = computed(() => {
  const schedule = query.data.value?.schedule
  if (!schedule || schedule.mode === 'manual') return uiText('jobs.manual')
  if (schedule.mode === 'cron') return 'Cron · ' + schedule.cron
  return uiText('jobs.intervalSummary', { minutes: schedule.intervalMinutes })
})

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

useEditGuard(dirty, () => actions.save.isPending.value)

async function save() {
  if (readonly.value || !draft.value || actions.save.isPending.value) return
  try {
    await form.value?.validate()
  } catch {
    return
  }
  if (readonly.value || !draft.value || actions.save.isPending.value) return
  try {
    await actions.save.mutateAsync({ id: id.value, input: JSON.parse(JSON.stringify(draft.value)) })
    baseline.value = JSON.stringify(draft.value)
    await router.push('/tasks/' + id.value)
  } catch {}
}

async function toggle() {
  if (readonly.value || !query.data.value || actions.toggle.isPending.value) return
  try {
    await actions.toggle.mutateAsync({ id: id.value, enabled: !query.data.value.enabled })
  } catch {}
}
</script>

<template>
  <PageHeader
    :title="query.data.value?.name ?? uiText('ui.task_9323d0aa')"
    :description="uiText('ui.task_7adc09b3')"
  >
    <NButton @click="router.push('/tasks')">{{ uiText('ui.task_f692ff9e') }}</NButton>
    <template v-if="editing">
      <NButton :disabled="actions.save.isPending.value" @click="router.push('/tasks/' + id)">
        {{ uiText('cancel') }}
      </NButton>
      <NButton
        type="primary"
        :disabled="readonly || !draft || query.isError.value"
        :loading="actions.save.isPending.value"
        @click="save"
      >
        {{ uiText('ui.task_817af187') }}
      </NButton>
    </template>
    <template v-else>
      <NButton :disabled="readonly" @click="router.push('/tasks/' + id + '/edit')">
        {{ uiText('ui.task_bb810789') }}
      </NButton>
      <NButton
        :disabled="readonly || !query.data.value"
        :loading="actions.toggle.isPending.value"
        @click="toggle"
      >
        {{ query.data.value?.enabled ? uiText('ui.tasks_130448bc') : uiText('ui.tasks_79748ca1') }}
      </NButton>
      <RunTrigger
        v-if="query.data.value"
        :dataset-id="query.data.value.datasetId"
        :write-mode="query.data.value.writeMode"
        @started="router.push('/runs/' + $event)"
      />
    </template>
  </PageHeader>

  <AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()">
    <NCard :bordered="false">
      <NAlert v-if="query.data.value?.writeMode" type="info" class="mb" :show-icon="false">
        {{
          uiText('jobs.publishedWriteMode', {
            version: query.data.value.datasetVersion,
            mode:
              query.data.value.writeMode === 'append'
                ? uiText('jobs.writeModes.append')
                : uiText('jobs.writeModes.replace'),
          })
        }}
        <NButton
          text
          type="primary"
          @click="router.push('/datasets/' + query.data.value!.datasetId + '/edit')"
          >{{ uiText('jobs.editDataset') }}</NButton
        >
      </NAlert>
      <NAlert v-if="!editing" type="info" class="mb">
        {{ uiText('ui.task_scheduleNote') }}
      </NAlert>
      <NForm
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
        :disabled="readonly || actions.save.isPending.value"
        label-placement="top"
      >
        <NFormItem path="name" :label="uiText('ui.task_2e304698')">
          <NInput
            v-model:value="draft.name"
            :input-props="{ 'aria-label': uiText('ui.task_2e304698') }"
          />
        </NFormItem>
        <ScheduleForm
          v-model="draft.schedule"
          :readonly="readonly || actions.save.isPending.value"
        />
      </NForm>
      <template v-else-if="query.data.value">
        <NDescriptions :column="2" bordered>
          <NDescriptionsItem :label="uiText('ui.task_fc2b4735')">
            {{ query.data.value.datasetId }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="uiText('ui.task_62e951a6')">
            {{ query.data.value.enabled ? uiText('ui.task_d4e9ca3d') : uiText('ui.task_130448bc') }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="uiText('ui.task_36019dc2')">
            {{ scheduleSummary }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="uiText('ui.task_fb2a23dc')">
            {{ query.data.value.schedule.timezone }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="uiText('jobs.sla')">
            {{ query.data.value.schedule.timeoutSeconds }}s
          </NDescriptionsItem>
          <NDescriptionsItem :label="uiText('jobs.nextRun')">
            <span v-if="query.data.value.nextRunAt">{{
              dateTime(query.data.value.nextRunAt)
            }}</span>
            <span v-else-if="!query.data.value.enabled">{{ uiText('jobs.paused') }}</span>
            <span v-else-if="query.data.value.schedule.mode === 'manual'">{{
              uiText('jobs.manual')
            }}</span>
            <span v-else>{{ uiText('jobs.unsupported') }}</span>
          </NDescriptionsItem>
          <NDescriptionsItem :label="uiText('jobs.lastSuccess')">
            <NButton
              v-if="query.data.value.lastSuccessRunId"
              text
              type="primary"
              @click="router.push('/runs/' + query.data.value!.lastSuccessRunId)"
            >
              {{ query.data.value.lastSuccessRunId }} · {{ query.data.value.lastSuccessAt }}
            </NButton>
            <span v-else>—</span>
          </NDescriptionsItem>
        </NDescriptions>
        <h3>{{ uiText('ui.task_a961a1c4') }}</h3>
        <RunHistory :scope="{ taskId: id }" @select="router.push('/runs/' + $event)" />
      </template>
    </NCard>
  </AsyncState>
</template>
