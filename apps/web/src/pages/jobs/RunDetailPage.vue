<script setup lang="ts">
import { ResponsiveDescriptions } from '@/shared/ui/responsive-descriptions'
import { useI18n as useUiI18n } from 'vue-i18n'
const { t: uiText } = useUiI18n()

import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NCard,
  NButton,
  NTag,
  NDescriptionsItem,
  NSteps,
  NStep,
  NAlert,
  NDataTable,
} from 'naive-ui'
import { useRun, RunActions } from '@/modules/jobs'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { CopyButton } from '@/shared/ui/copy-button'
import { useDisplayTime } from '@/shared/composables/use-display-time'
const route = useRoute(),
  router = useRouter(),
  { t } = useI18n(),
  id = computed(() => String(route.params.id)),
  query = useRun(id)
const dateTime = useDisplayTime()
const retryable = computed(() =>
    ['failed', 'blocked', 'canceled'].includes(query.data.value?.status ?? ''),
  ),
  step = computed(() =>
    Math.max(
      1,
      ['queued', 'running', 'validating', 'publishing', 'succeeded'].indexOf(
        query.data.value?.status ?? 'queued',
      ) + 1,
    ),
  ),
  retryPending = computed(() =>
    Boolean(
      query.data.value?.retryAt && !query.data.value.retryRunId && !query.data.value.retryPaused,
    ),
  ),
  retryPaused = computed(() => Boolean(query.data.value?.retryPaused))
</script>
<template>
  <PageHeader
    :title="uiText('ui.run_detail_51b0e86f') + id"
    :description="uiText('ui.run_detail_f707503b')"
    ><RunActions
      v-if="query.data.value"
      :run="query.data.value"
      @retried="router.push('/runs/' + $event)" /></PageHeader
  ><NAlert v-if="retryPending" type="info" class="mb">
    {{ t('jobs.automaticRetryPending', { time: dateTime(query.data.value?.retryAt ?? '') }) }}
  </NAlert>
  <NAlert v-if="retryPaused" type="warning" class="mb">{{ t('jobs.automaticRetryPaused') }}</NAlert
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><NCard :bordered="false" class="mb"
      ><ResponsiveDescriptions :max-columns="3" bordered
        ><NDescriptionsItem :label="uiText('ui.run_detail_62e951a6')"
          ><NTag
            :bordered="false"
            :type="query.data.value?.status === 'succeeded' ? 'success' : 'warning'"
            >{{ t('states.' + query.data.value?.status) }}</NTag
          ></NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.run_detail_fc2b4735')"
          ><NButton
            text
            type="primary"
            @click="router.push('/datasets/' + query.data.value?.datasetId)"
            >{{ query.data.value?.datasetId }}</NButton
          ></NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.run_detail_fa854c5a')"
          ><NButton
            text
            @click="
              router.push(
                '/datasets/' +
                  query.data.value?.datasetId +
                  '/versions/' +
                  query.data.value?.datasetVersion,
              )
            "
            >v{{ query.data.value?.datasetVersion }}</NButton
          ></NDescriptionsItem
        ><NDescriptionsItem label="Run ID">{{ id }}<CopyButton :value="id" /></NDescriptionsItem
        ><NDescriptionsItem :label="t('jobs.businessDate')"
          >{{ query.data.value?.businessDate ?? '—' }} ·
          {{ query.data.value?.scheduleSnapshot.timezone }}</NDescriptionsItem
        ><NDescriptionsItem :label="t('jobs.executionStarted')">{{
          query.data.value?.executionStartedAt ?? '—'
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="t('jobs.runDependencies')"
          ><template v-if="query.data.value?.scheduleSnapshot.dependencies.length"
            ><NButton
              v-for="dependency in query.data.value.scheduleSnapshot.dependencies"
              :key="dependency"
              text
              type="primary"
              @click="router.push('/tasks/' + dependency)"
              >{{ t('jobs.dependencyTask', { id: dependency }) }}</NButton
            ></template
          ><span v-else>{{ t('jobs.noDependencies') }}</span></NDescriptionsItem
        ><NDescriptionsItem :label="t('jobs.admissionSnapshot')">{{
          t('jobs.admissionSummary', {
            concurrency: query.data.value?.scheduleSnapshot.concurrency,
            timeout: query.data.value?.scheduleSnapshot.timeoutSeconds,
            retries: query.data.value?.scheduleSnapshot.retries,
          })
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="t('jobs.duration')"
          >{{ query.data.value?.durationMs ?? 0 }} ms</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.run_detail_3a2573f2')">{{
          query.data.value?.trigger
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.run_detail_fd06b03a')"
          ><NButton
            v-if="query.data.value?.retryOf"
            text
            @click="router.push('/runs/' + query.data.value.retryOf)"
            >{{ query.data.value.retryOf }}</NButton
          ><span v-else>—</span></NDescriptionsItem
        ><NDescriptionsItem :label="t('jobs.retryChild')"
          ><NButton
            v-if="query.data.value?.retryRunId"
            text
            type="primary"
            @click="router.push('/runs/' + query.data.value.retryRunId)"
            >{{ query.data.value.retryRunId }}</NButton
          ><span v-else>—</span></NDescriptionsItem
        ><NDescriptionsItem :label="t('jobs.retryAttempt')"
          >{{ query.data.value?.retryAttempt ?? 0 }} ·
          {{ query.data.value?.retryMode ?? 'manual' }}</NDescriptionsItem
        ><NDescriptionsItem v-if="query.data.value?.retryAt" :label="t('jobs.retryAt')">{{
          dateTime(query.data.value.retryAt)
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.run_detail_e8850440')">{{
          query.data.value?.datasetId
        }}</NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.run_detail_dab09665')"
          ><NButton
            v-if="query.data.value?.outputTableId"
            text
            type="primary"
            @click="router.push('/warehouse/tables/' + query.data.value.outputTableId)"
            >{{ query.data.value.outputTableId }}</NButton
          ><span v-else>{{ uiText('ui.run_detail_ff233aab') }}</span></NDescriptionsItem
        ><NDescriptionsItem :label="uiText('ui.run_detail_05799576')">{{
          query.data.value?.rowCount
        }}</NDescriptionsItem></ResponsiveDescriptions
      ><NSteps :current="step" :status="retryable ? 'error' : 'process'" style="margin-top: 32px"
        ><NStep :title="uiText('ui.run_detail_cfb281f6')" /><NStep
          :title="uiText('ui.run_detail_b6b97ac6')" /><NStep
          :title="uiText('ui.run_detail_20feecea')" /><NStep
          :title="uiText('ui.run_detail_94f172d0')" /><NStep
          :title="uiText('ui.run_detail_33246f6a')" /></NSteps></NCard
    ><NAlert v-if="query.data.value?.waitReason" type="info" class="mb">{{
      query.data.value.waitReason === 'dependencies'
        ? t('jobs.waitingDependencies')
        : t('jobs.waitingConcurrency')
    }}</NAlert
    ><NAlert v-if="query.data.value?.errorCode" type="warning" class="mb"
      >{{ query.data.value.errorCode }}{{ uiText('ui.run_detail_057a1285') }}</NAlert
    ><NCard :title="uiText('ui.run_detail_560d2c9f')" :bordered="false" class="mb">
      <pre class="run-log">{{
        query.data.value?.logs
          .map((line, i) => String(i + 1).padStart(2, '0') + '  ' + line)
          .join(String.fromCharCode(10))
      }}</pre></NCard
    ><NCard :title="uiText('ui.run_detail_128c723a')" :bordered="false"
      ><NAlert v-if="!query.data.value?.qualityResults.length" type="info">{{
        t('jobs.qualityPending')
      }}</NAlert
      ><NDataTable
        v-else
        :data="query.data.value?.qualityResults ?? []"
        :columns="[
          { title: uiText('ui.run_detail_ed904c68'), key: 'ruleId' },
          { title: uiText('ui.run_detail_0700f94d'), key: 'version' },
          { title: uiText('ui.run_detail_0a2c91ce'), key: 'result' },
          { title: uiText('ui.run_detail_26670dda'), key: 'message' },
        ]"
        :bordered="false" /></NCard
  ></AsyncState>
</template>
<style scoped>
.run-log {
  background: var(--surface);
  padding: 20px;
  border-radius: 10px;
  line-height: 2;
  white-space: pre-wrap;
  font-size: 13px;
}
</style>
