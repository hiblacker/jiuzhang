<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NFormItem,
  NSelect,
  NInput,
  NInputNumber,
  NGrid,
  NFormItemGi,
  NAlert,
  type FormItemRule,
} from 'naive-ui'
import type { Model } from '@/shared/api/types'
import { dateTime } from '@/shared/lib/datetime'
import { vSelectTriggerName } from '@/shared/ui/select-trigger-name'
import { previewSchedule } from '../model/schedule-preview'
import { scheduleIssue } from '../model/schedule-validation'
import TaskDependencySelect from './TaskDependencySelect.vue'
const model = defineModel<Model<'Schedule'>>({ required: true })
const props = withDefaults(
  defineProps<{
    readonly?: boolean
    excludedTaskId?: string
    excludedDatasetId?: string
    path?: string
  }>(),
  { path: 'schedule' },
)
const { t } = useI18n()
const preview = computed(() => previewSchedule(model.value))
function rule(field: keyof Model<'Schedule'>): FormItemRule {
  return {
    trigger: ['blur', 'change'],
    validator: () => {
      const issue = scheduleIssue(model.value, field)
      return issue ? new Error(t(issue)) : true
    },
  }
}
</script>
<template>
  <NAlert type="info" class="mb">{{ t('jobs.scheduleHelp') }}</NAlert>
  <NGrid cols="1 640:2" responsive="self" :x-gap="24">
    <NFormItemGi :label="t('ui.schedule_form_067b6d57')">
      <NSelect
        v-model:value="model.mode"
        :disabled="readonly"
        v-select-trigger-name="t('ui.schedule_form_067b6d57')"
        :options="[
          { label: t('ui.schedule_form_2a4a4de8'), value: 'manual' },
          { label: 'Cron', value: 'cron' },
          { label: t('ui.schedule_form_3118c325'), value: 'interval' },
        ]"
      />
    </NFormItemGi>
    <NFormItemGi
      :label="t('ui.schedule_form_fb2a23dc')"
      :path="props.path + '.timezone'"
      :rule="rule('timezone')"
    >
      <NSelect
        v-model:value="model.timezone"
        :disabled="readonly"
        v-select-trigger-name="t('ui.schedule_form_fb2a23dc')"
        :options="['Asia/Shanghai', 'UTC'].map((value) => ({ label: value, value }))"
      />
    </NFormItemGi>
    <NFormItemGi
      v-if="model.mode === 'cron'"
      label="Cron"
      :path="props.path + '.cron'"
      :rule="rule('cron')"
    >
      <NInput
        v-model:value="model.cron"
        :disabled="readonly"
        :input-props="{ 'aria-label': 'Cron' }"
        placeholder="0 9 * * *"
      />
    </NFormItemGi>
    <NFormItemGi
      v-if="model.mode === 'interval'"
      :label="t('ui.schedule_form_6c7f21d2')"
      :path="props.path + '.intervalMinutes'"
      :rule="rule('intervalMinutes')"
    >
      <NInputNumber
        v-model:value="model.intervalMinutes"
        :disabled="readonly"
        :input-props="{ 'aria-label': t('ui.schedule_form_6c7f21d2') }"
        :min="1"
        :max="525600"
        :precision="0"
      />
    </NFormItemGi>
    <NFormItemGi
      :label="t('ui.schedule_form_11b03b3f')"
      :path="props.path + '.retries'"
      :rule="rule('retries')"
    >
      <NInputNumber
        v-model:value="model.retries"
        :disabled="readonly"
        :input-props="{ 'aria-label': t('ui.schedule_form_11b03b3f') }"
        :min="0"
        :max="10"
        :precision="0"
      />
    </NFormItemGi>
    <NFormItemGi
      :label="t('ui.schedule_form_2c38c10e')"
      :path="props.path + '.timeoutSeconds'"
      :rule="rule('timeoutSeconds')"
    >
      <NInputNumber
        v-model:value="model.timeoutSeconds"
        :disabled="readonly"
        :input-props="{ 'aria-label': t('ui.schedule_form_2c38c10e') }"
        :min="1"
        :max="86400"
        :precision="0"
      />
    </NFormItemGi>
    <NFormItemGi
      :label="t('ui.schedule_form_3bd2de2f')"
      :path="props.path + '.concurrency'"
      :rule="rule('concurrency')"
    >
      <NInputNumber
        v-model:value="model.concurrency"
        :disabled="readonly"
        :input-props="{ 'aria-label': t('ui.schedule_form_3bd2de2f') }"
        :min="1"
        :max="10"
        :precision="0"
      />
    </NFormItemGi>
  </NGrid>
  <NFormItem
    :label="t('ui.schedule_form_8a88d05f')"
    :path="props.path + '.dependencies'"
    :rule="rule('dependencies')"
  >
    <TaskDependencySelect
      v-model:value="model.dependencies"
      :disabled="readonly"
      :excluded-task-id="excludedTaskId"
      :excluded-dataset-id="excludedDatasetId"
    />
  </NFormItem>
  <NAlert type="info" class="mb">{{ t('jobs.dependencyPolicy') }}</NAlert>
  <NAlert v-if="!preview.supported" type="warning">{{ t('jobs.unsupportedCron') }}</NAlert>
  <NAlert v-else-if="model.mode === 'cron' && !preview.dates.length" type="warning">
    {{ t('jobs.noCronMatch') }}
  </NAlert>
  <div v-else-if="preview.dates.length">
    <h3>{{ t('jobs.nextRuns') }}</h3>
    <ol>
      <li v-for="value in preview.dates" :key="value">
        {{ dateTime(value, model.timezone) }} · {{ model.timezone }}
      </li>
    </ol>
  </div>
</template>
