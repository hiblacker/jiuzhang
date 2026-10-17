<script setup lang="ts">
import { computed, defineAsyncComponent, h } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NButton,
  NCard,
  NEmpty,
  NTag,
  NDataTable,
  NProgress,
  type DataTableColumns,
} from 'naive-ui'
import {
  ArrowUpRight,
  Plus,
  Database,
  Layers,
  Activity,
  ShieldAlert,
  ArrowRight,
} from 'lucide-vue-next'
import { useOverview } from '@/modules/overview'
import { PageHeader } from '@/shared/ui/page-header'
import { AsyncState } from '@/shared/ui/async-state'
import { useDisplayTime } from '@/shared/composables/use-display-time'
const dateTime = useDisplayTime()
import type { Model } from '@/shared/api/types'
const TrendChart = defineAsyncComponent(() => import('@/shared/charts/TrendChart.vue'))
const query = useOverview(),
  router = useRouter(),
  { t } = useI18n()
const metrics = computed(() => [
  {
    label: t('overview.sources'),
    value: query.data.value?.sourceCount ?? 0,
    icon: Database,
    path: '/sources',
  },
  {
    label: t('overview.datasets'),
    value: query.data.value?.publishedCount ?? 0,
    icon: Layers,
    path: '/datasets?status=published',
  },
  {
    label: t('overview.runs'),
    value: query.data.value?.successCount ?? 0,
    icon: Activity,
    path: '/runs?status=succeeded',
  },
  {
    label: t('overview.blocked'),
    value: query.data.value?.blockedCount ?? 0,
    icon: ShieldAlert,
    path: '/runs?status=blocked',
  },
])
const attention = computed(() => [
  {
    label: t('overview.draftDatasets'),
    count: query.data.value?.attentionCounts.draftDatasets ?? 0,
    path: '/datasets?status=draft',
  },
  {
    label: t('overview.warningSources'),
    count: query.data.value?.attentionCounts.warningSources ?? 0,
    path: '/sources?status=warning',
  },
  {
    label: t('overview.offlineSources'),
    count: query.data.value?.attentionCounts.offlineSources ?? 0,
    path: '/sources?status=offline',
  },
])
const columns = computed<DataTableColumns<Model<'Run'>>>(() => [
  {
    title: 'Run ID',
    key: 'id',
    render: (r) =>
      h(
        NButton,
        { text: true, type: 'primary', onClick: () => router.push('/runs/' + r.id) },
        { default: () => r.id },
      ),
  },
  {
    title: t('status'),
    key: 'status',
    render: (r) =>
      h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type: (
            {
              succeeded: 'success',
              failed: 'error',
              queued: 'warning',
              running: 'warning',
              validating: 'warning',
              publishing: 'warning',
              blocked: 'warning',
              canceled: 'default',
            } as const
          )[r.status],
        },
        { default: () => t('states.' + r.status) },
      ),
  },
  { title: 'Version', key: 'datasetVersion', render: (r) => 'v' + r.datasetVersion },
  { title: t('updated'), key: 'startedAt', render: (r) => dateTime(r.startedAt) },
])
</script>
<template>
  <PageHeader :title="t('overview.title')" :description="t('overview.description')"
    ><NButton type="primary" @click="router.push('/sources/new')"
      ><template #icon><Plus :size="16" /></template>{{ t('overview.newSource') }}</NButton
    ></PageHeader
  ><AsyncState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch()"
    ><section class="welcome-banner">
      <div>
        <div class="eyebrow">JIUZHANG / DATA WORKSPACE</div>
        <h2>{{ t('overview.welcome') }}</h2>
        <p>{{ t('overview.welcomeHint') }}</p>
        <NButton text @click="router.push('/datasets')"
          >{{ t('overview.openDatasets') }} <ArrowRight :size="16"
        /></NButton>
      </div>
      <div class="flow-art" aria-hidden="true">
        <Database :size="30" /><span>····</span><Layers :size="34" /><span>····</span
        ><Activity :size="30" />
      </div>
    </section>
    <div class="metric-grid">
      <NCard v-for="metric in metrics" :key="metric.path" :bordered="false" class="metric-card"
        ><div class="metric-top">
          <span>{{ metric.label }}</span
          ><component :is="metric.icon" :size="19" />
        </div>
        <div class="metric-value">
          {{ metric.value
          }}<NButton quaternary circle :aria-label="metric.label" @click="router.push(metric.path)"
            ><ArrowUpRight :size="18"
          /></NButton>
        </div>
        <div class="metric-foot">{{ t('mock') }} · {{ t('workspace') }}</div></NCard
      >
    </div>
    <div class="dashboard-grid">
      <NCard :title="t('overview.trend')" :bordered="false"
        ><template #header-extra
          ><span class="muted">{{ t('overview.trendHint') }}</span></template
        ><TrendChart
          :labels="[t('states.succeeded'), t('overview.failedOrBlocked')]"
          :points="query.data.value?.trend ?? []" /></NCard
      ><NCard :title="t('overview.governance')" :bordered="false"
        ><div v-for="layer in query.data.value?.layerCounts" :key="layer.layer" class="layer-row">
          <div>
            <strong>{{ layer.layer }}</strong
            ><span>{{ layer.tables }} {{ t('overview.tables') }}</span>
          </div>
          <NProgress
            type="line"
            :percentage="Math.round((layer.tables / (query.data.value?.tableCount || 1)) * 100)"
            :show-indicator="false"
            :height="7"
          />
        </div>
        <NButton text type="primary" @click="router.push('/warehouse/tables')"
          >{{ t('overview.viewAll') }} <ArrowUpRight :size="16" /></NButton
      ></NCard>
      <section :aria-label="t('overview.failures')">
        <NCard :title="t('overview.failures')" :bordered="false">
          <template #header-extra>
            <div class="failure-links">
              <NButton text type="primary" @click="router.push('/runs?status=failed')">{{
                t('overview.failedRuns')
              }}</NButton>
              <NButton text type="primary" @click="router.push('/runs?status=blocked')">{{
                t('overview.blockedRuns')
              }}</NButton>
            </div>
          </template>
          <NEmpty
            v-if="query.data.value?.recentFailures.length === 0"
            :description="t('overview.noFailures')"
            class="section-empty"
          />
          <NDataTable
            v-else
            :columns="columns"
            :data="query.data.value?.recentFailures ?? []"
            :bordered="false"
          />
        </NCard>
      </section>
      <section :aria-label="t('overview.pending')">
        <NCard :title="t('overview.pending')" :bordered="false">
          <p class="attention-hint">{{ t('overview.pendingHint') }}</p>
          <NEmpty
            v-if="attention.every((item) => item.count === 0)"
            :description="t('overview.noPending')"
            class="section-empty"
          />
          <div class="attention-list">
            <NButton
              v-for="item in attention"
              :key="item.path"
              :aria-label="t('overview.pendingAction', { label: item.label, count: item.count })"
              :disabled="item.count === 0"
              block
              quaternary
              @click="router.push(item.path)"
            >
              <span class="attention-label">{{ item.label }}</span>
              <NTag size="small" :bordered="false">{{ item.count }}</NTag>
              <ArrowUpRight :size="16" />
            </NButton>
          </div>
        </NCard>
      </section>
      <NCard :title="t('overview.recent')" :bordered="false"
        ><template #header-extra
          ><NButton text type="primary" @click="router.push('/runs')">{{
            t('overview.viewAll')
          }}</NButton></template
        ><NDataTable
          :columns="columns"
          :data="query.data.value?.recentRuns ?? []"
          :bordered="false" /></NCard
      ><NCard :title="t('overview.activity')" :bordered="false"
        ><div v-for="event in query.data.value?.recentAudit" :key="event.id" class="activity-item">
          <span class="activity-dot" />
          <div>
            <strong>{{ event.detail }}</strong>
            <p>{{ event.actor }} · {{ event.resource }}</p>
            <small>{{ dateTime(event.at) }}</small>
          </div>
        </div></NCard
      >
    </div></AsyncState
  >
</template>
<style scoped>
.welcome-banner {
  padding: 28px 32px;
  border: 1px solid var(--border);
  background: var(--accentSoft);
  border-radius: 14px;
  margin-bottom: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.eyebrow {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--accent);
  font-weight: 700;
}
.welcome-banner h2 {
  font-size: 23px;
  margin: 10px 0;
}
.welcome-banner p {
  color: var(--textSecondary);
  font-size: 13px;
  margin-bottom: 18px;
}
.flow-art {
  display: flex;
  align-items: center;
  gap: 24px;
  color: var(--accent);
  padding: 20px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}
.metric-top {
  display: flex;
  justify-content: space-between;
  color: var(--textSecondary);
  font-size: 13px;
}
.metric-top svg {
  color: var(--accent);
}
.metric-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 36px;
  font-weight: 650;
  line-height: 1.7;
}
.metric-foot {
  color: var(--textSecondary);
  font-size: 11px;
}
.dashboard-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 24px;
}
.dashboard-grid > * {
  min-width: 0;
}
.failure-links {
  display: flex;
  gap: 14px;
}
.attention-hint {
  margin: 0 0 16px;
  color: var(--textSecondary);
  font-size: 12px;
}
.attention-list {
  display: grid;
  gap: 10px;
}
.attention-label {
  margin-right: 16px;
}
.section-empty {
  padding: 24px 0;
}
.layer-row {
  margin: 16px 0 28px;
}
.layer-row > div {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}
.layer-row span {
  color: var(--textSecondary);
  font-size: 12px;
}
.activity-item {
  display: flex;
  gap: 12px;
  margin: 16px 0 24px;
  font-size: 12px;
}
.activity-item strong {
  font-weight: 500;
}
.activity-item p {
  color: var(--textSecondary);
  margin: 5px 0;
}
.activity-item small {
  color: var(--textSecondary);
}
.activity-dot {
  width: 7px;
  height: 7px;
  background: var(--accent);
  border-radius: 50%;
  margin-top: 6px;
}
@media (max-width: 1100px) {
  .flow-art {
    display: none;
  }
  .metric-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
